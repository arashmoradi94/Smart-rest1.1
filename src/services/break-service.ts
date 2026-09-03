import { prisma } from "@/lib/db";
import { addMinutes, AppError } from "@/lib/utils";
import { publishStates } from "@/lib/events";
import { calculateEndDelay, calculateStartDelay } from "@/services/break-scheduler";
import { getSettings } from "@/services/settings-service";
import { ensureNextBreak, getActiveShift } from "@/services/shift-service";

/**
 * All start/return transitions are server-side, atomic (conditional updateMany
 * inside a transaction) and based on ServerTime. scheduledStart/scheduledEnd
 * are only suggestions: a break never auto-starts and never auto-ends; the
 * user (or an admin override) drives every transition.
 */

/** LIVE break states: the running break either within or past its fixed end. */
export function liveBreakStatus(
  brk: { actualStart: Date | null; actualEnd: Date | null; status: string },
  endsAt: Date,
  now: Date,
): "ACTIVE" | "OVERTIME" {
  if (brk.actualEnd || !brk.actualStart) return brk.status as "ACTIVE";
  return now > endsAt ? "OVERTIME" : "ACTIVE";
}

/** Persist the OVERTIME state for running breaks past their fixed end. */
export async function syncOvertimeBreaks(userId: string, now: Date): Promise<void> {
  const settings = await getSettings();
  const running = await prisma.break.findMany({
    where: { userId, actualStart: { not: null }, actualEnd: null, status: "ACTIVE" },
  });
  for (const brk of running) {
    const endsAt = addMinutes(brk.actualStart!, settings.breakDurationMinutes + brk.extendMinutes);
    if (now > endsAt) {
      await prisma.break
        .updateMany({ where: { id: brk.id, status: "ACTIVE", actualEnd: null }, data: { status: "OVERTIME" } })
        .catch(() => {});
    }
  }
}

export async function startBreak(userId: string, now = new Date(), opts?: { force?: boolean }) {
  const settings = await getSettings();
  let shift = await getActiveShift(userId);
  if (!shift) throw new AppError("ابتدا شیفت خود را شروع کنید", 409);

  await ensureNextBreak(shift, settings, now);
  shift = (await getActiveShift(userId))!;

  const open = shift.breaks[shift.breaks.length - 1];
  if (open && (open.status === "ACTIVE" || open.status === "OVERTIME")) {
    throw new AppError("شما هم‌اکنون در استراحت هستید", 409);
  }

  if (!open || open.status !== "SCHEDULED") {
    throw new AppError("استراحت برنامه‌ریزی‌شده‌ای برای شما وجود ندارد", 409);
  }

  // A break linked to a forming group must go through the buddy flow so every
  // member starts on the same shared server timestamp. Leaving the group or an
  // admin force-start detaches it first.
  if (open.groupBreakId && !opts?.force) {
    const group = await prisma.groupBreak.findUnique({ where: { id: open.groupBreakId } });
    if (group?.status === "FORMING" || group?.status === "DELAYED") {
      throw new AppError("استراحت شما با گروه Buddy هماهنگ است؛ از پنل گروه استفاده کنید", 409);
    }
  }

  // Atomic transition: conditional update is the single source of truth.
  // Capacity is re-checked inside the same transaction so concurrent starts
  // can never exceed maxConcurrentBreaks.
  const started = await prisma.$transaction(async (tx) => {
    const activeCount = await tx.break.count({
      where: { actualStart: { not: null }, actualEnd: null },
    });
    if (activeCount >= settings.maxConcurrentBreaks) {
      throw new AppError("ظرفیت استراحت همزمان تکمیل است؛ چند لحظه دیگر تلاش کنید", 409);
    }
    const startDelayMinutes = calculateStartDelay(open.scheduledStart, now);
    const res = await tx.break.updateMany({
      where: { id: open.id, status: "SCHEDULED", actualStart: null, actualEnd: null },
      data: { actualStart: now, status: "ACTIVE", startDelayMinutes },
    });
    if (res.count !== 1) {
      throw new AppError("استراحت هم‌اکنون آغاز شده یا دیگر قابل آغاز نیست", 409);
    }
    await tx.user.update({ where: { id: userId }, data: { status: "ON_BREAK" } });
    return startDelayMinutes;
  });

  if (started <= 1) {
    const { awardCoins, COIN_RULES } = await import("@/services/gamification-service");
    await awardCoins(userId, COIN_RULES.BREAK_ON_TIME, `BREAK_ONTIME:${open.id}`).catch(() => {});
  }
  const { logAudit } = await import("@/lib/audit");
  await logAudit(userId, "BREAK_START", `break:${open.id} delay:${started}m`);
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(userId, { title: "☕ استراحت", body: "زمان استراحت شما شروع شد.", tag: "break-start", kind: "break-start", url: "/dashboard" }).catch(() => {});
  publishStates([userId]);
  const { getEmployeeState } = await import("@/services/state-service");
  return getEmployeeState(userId, now);
}

export async function startEmergencyBreak(
  userId: string,
  reason: "RESTROOM" | "ILLNESS" | "URGENT_REST" | "OTHER",
  note?: string,
  now = new Date(),
) {
  const shift = await getActiveShift(userId);
  if (!shift) throw new AppError("ابتدا شیفت خود را شروع کنید", 409);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { onCall: true } });
  if (user?.onCall) throw new AppError("هنگام تماس امکان استراحت اضطراری ندارید", 409);
  const active = shift.breaks.find((b) => b.status === "ACTIVE" || b.status === "OVERTIME");
  if (active) throw new AppError("شما هم‌اکنون در استراحت هستید", 409);
  const regular = shift.breaks.filter((b) => b.kind !== "EMERGENCY");
  const last = regular[regular.length - 1];
  const created = await prisma.$transaction(async (tx) => {
    const open = await tx.break.findFirst({ where: { shiftId: shift.id, status: { in: ["ACTIVE", "OVERTIME"] } } });
    if (open) throw new AppError("استراحت دیگری در حال اجراست", 409);
    const emergency = await tx.break.create({
      data: {
        shiftId: shift.id,
        userId,
        breakIndex: (last?.breakIndex ?? -1) + 1,
        scheduledStart: now,
        scheduledEnd: now,
        actualStart: now,
        kind: "EMERGENCY",
        emergencyReason: reason,
        emergencyNote: note?.trim().slice(0, 240) || null,
        status: "ACTIVE",
      },
    });
    await tx.user.update({ where: { id: userId }, data: { status: "ON_BREAK" } });
    return emergency;
  });
  await (await import("@/lib/audit")).logAudit(userId, "EMERGENCY_BREAK_START", `break:${created.id} reason:${reason}`);
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(userId, {
    title: "🚨 استراحت اضطراری",
    body: "استراحت اضطراری شما آغاز شد.",
    tag: `emergency-start:${created.id}`,
    kind: "break-start",
    url: "/dashboard",
  }).catch(() => {});
  publishStates([userId]);
  const { getEmployeeState } = await import("@/services/state-service");
  return getEmployeeState(userId, now);
}

export async function returnToWork(userId: string, now = new Date()) {
  const settings = await getSettings();
  const shift = await getActiveShift(userId);
  if (!shift) throw new AppError("شیفت فعالی ندارید", 409);

  const open = shift.breaks.find((b) => b.status === "ACTIVE" || b.status === "OVERTIME");
  if (!open) throw new AppError("در حال حاضر در استراحت نیستید", 409);
  if (!open.actualStart) throw new AppError("وضعیت استراحت نامعتبر است", 409);
  if (open.kind === "EMERGENCY") {
    const durationMinutes = Math.max(0, Math.round((now.getTime() - open.actualStart.getTime()) / 60_000));
    const ended = await prisma.$transaction(async (tx) => {
      const res = await tx.break.updateMany({
        where: { id: open.id, status: { in: ["ACTIVE", "OVERTIME"] }, actualEnd: null },
        data: { actualEnd: now, durationMinutes, status: "COMPLETED" },
      });
      if (res.count !== 1) throw new AppError("استراحت اضطراری قبلاً پایان یافته است", 409);
      await tx.user.update({ where: { id: userId }, data: { status: "WORKING" } });
      return durationMinutes;
    });
    await (await import("@/lib/audit")).logAudit(userId, "EMERGENCY_BREAK_RETURN", `break:${open.id} duration:${ended}m`);
    const fresh = (await getActiveShift(userId))!;
    await ensureNextBreak(fresh, settings, now);
    publishStates([userId]);
    const { getEmployeeState } = await import("@/services/state-service");
    return getEmployeeState(userId, now);
  }

  // Server rule: the break ALWAYS gets its full duration from actualStart
  // (+ admin-granted extension). Starting late never shortens it.
  const fixedEnd = addMinutes(open.actualStart, settings.breakDurationMinutes + open.extendMinutes);
  const endDelay = calculateEndDelay(fixedEnd, now);
  const ended = await prisma.$transaction(async (tx) => {
    const res = await tx.break.updateMany({
      where: { id: open.id, status: { in: ["ACTIVE", "OVERTIME"] }, actualStart: { not: null }, actualEnd: null },
      data: {
        actualEnd: fixedEnd,
        durationMinutes: settings.breakDurationMinutes + open.extendMinutes,
        endDelayMinutes: endDelay,
        status: endDelay > 0 ? "LATE" : "COMPLETED",
      },
    });
    if (res.count !== 1) throw new AppError("استراحت قبلاً پایان یافته است", 409);
    await tx.user.update({ where: { id: userId }, data: { status: "WORKING" } });
    return endDelay;
  });

  if (ended === 0) {
    const { awardCoins, COIN_RULES } = await import("@/services/gamification-service");
    await awardCoins(userId, COIN_RULES.RETURN_ON_TIME, `RETURN_ONTIME:${open.id}`).catch(() => {});
  }
  // Close the group break once every member has returned
  if (open.groupBreakId) {
    const stillRunning = await prisma.break.count({
      where: { groupBreakId: open.groupBreakId, actualEnd: null },
    });
    if (stillRunning === 0) {
      await prisma.groupBreak.updateMany({
        where: { id: open.groupBreakId, status: "ACTIVE" },
        data: { status: "COMPLETED" },
      }).catch(() => {});
    }
  }
  const { logAudit } = await import("@/lib/audit");
  await logAudit(userId, "BREAK_RETURN", `break:${open.id} endDelay:${ended}m`);
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(userId, { title: "💼 بازگشت به کار", body: "ثبت شد. موفق باشی!", tag: "return", kind: "break-end", url: "/dashboard" }).catch(() => {});

  const fresh = (await getActiveShift(userId))!;
  await ensureNextBreak(fresh, settings, now);
  publishStates([userId]);
  const { getEmployeeState } = await import("@/services/state-service");
  return getEmployeeState(userId, now);
}

/** Admin: extend a running break without shortening its guaranteed duration. */
export async function extendBreak(adminId: string, breakId: string, minutes: number) {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 120) {
    throw new AppError("مدت تمید باید عددی بین ۱ تا ۱۲۰ دقیقه باشد", 400);
  }
  const brk = await prisma.break.findUnique({ where: { id: breakId } });
  if (!brk) throw new AppError("استراحت یافت نشد", 404);
  if (!brk.actualStart || brk.actualEnd) {
    throw new AppError("فقط استراحت در حال اجرا قابل تمید است", 409);
  }
  await prisma.break.update({
    where: { id: breakId },
    data: { extendMinutes: brk.extendMinutes + minutes },
  });
  const { logAudit } = await import("@/lib/audit");
  await logAudit(adminId, "EXTEND_BREAK", `break:${breakId} +${minutes}m`).catch(() => {});
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(brk.userId, {
    title: "⏳ استراحت شما تمدید شد",
    body: `مدیر استراحت شما را ${minutes.toLocaleString("fa-IR")} دقیقه تمدید کرد.`,
    tag: "extend",
    kind: "announcement",
    url: "/dashboard",
  }).catch(() => {});
  publishStates([brk.userId]);
  return { ok: true };
}

/** Admin: cancel a not-yet-started break (never destroys history). */
export async function cancelBreak(adminId: string, breakId: string) {
  const brk = await prisma.break.findUnique({ where: { id: breakId } });
  if (!brk) throw new AppError("استراحت یافت نشد", 404);
  if (brk.actualStart && !brk.actualEnd) {
    throw new AppError("استراحت در حال اجراست؛ ابتدا بازگشت را ثبت کنید", 409);
  }
  if (brk.actualEnd) throw new AppError("استراحت پایان‌یافته قابل لغو نیست", 409);
  const res = await prisma.break.updateMany({
    where: { id: breakId, status: "SCHEDULED", actualStart: null },
    data: { status: "CANCELLED" },
  });
  if (res.count !== 1) throw new AppError("استراحت قابل لغو نیست", 409);
  const { logAudit } = await import("@/lib/audit");
  await logAudit(adminId, "CANCEL_BREAK", `break:${breakId} user:${brk.userId}`).catch(() => {});
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(brk.userId, {
    title: "🚫 استراحت شما لغو شد",
    body: "مدیر استراحت برنامه‌ریزی‌شده شما را لغو کرد؛ استراحت بعدی طبق برنامه.",
    tag: "cancel-break",
    kind: "announcement",
    url: "/dashboard",
  }).catch(() => {});
  publishStates([brk.userId]);
  return { ok: true };
}

/** Employee: leave a forming buddy group so they can start individually. */
export async function leaveGroup(userId: string) {
  const membership = await prisma.groupBreakMember.findFirst({
    where: { userId },
    include: { groupBreak: true },
    orderBy: { id: "desc" },
  });
  if (!membership || !["FORMING", "DELAYED"].includes(membership.groupBreak.status)) {
    throw new AppError("گروه فعالی برای خروج وجود ندارد", 409);
  }
  const members = await prisma.groupBreakMember.count({
    where: { groupBreakId: membership.groupBreakId },
  });
  await prisma.$transaction([
    prisma.groupBreakMember.delete({ where: { id: membership.id } }),
    // Last member leaving closes the group
    ...(members <= 1
      ? [prisma.groupBreak.update({ where: { id: membership.groupBreakId }, data: { status: "CANCELLED" } })]
      : []),
  ]);
  await prisma.break.updateMany({
    where: { userId, groupBreakId: membership.groupBreakId, status: "SCHEDULED" },
    data: { groupBreakId: null },
  });
  const { logAudit } = await import("@/lib/audit");
  await logAudit(userId, "LEAVE_GROUP", `group:${membership.groupBreakId}`);
  publishStates([userId]);
  return { ok: true };
}
