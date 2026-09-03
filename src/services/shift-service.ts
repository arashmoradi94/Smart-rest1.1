import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { addMinutes, AppError, diffMinutes } from "@/lib/utils";
import { publishStates } from "@/lib/events";
import { getSettings } from "@/services/settings-service";
import { resolveBreakWithCapacity } from "@/services/break-scheduler";
import type { FullSettings, ShiftReport, UserStatus } from "@/types";

type ShiftWithBreaks = Prisma.ShiftGetPayload<{ include: { breaks: true } }>;

export async function getServerTime(): Promise<Date> {
  return new Date();
}

export async function getActiveShift(userId: string) {
  if (!userId) throw new AppError("درخواست نامعتبر است", 400);
  return prisma.shift.findFirst({
    where: { userId, status: "ACTIVE" },
    include: { breaks: { orderBy: { breakIndex: "asc" } } },
  });
}

export async function startShift(userId: string, now = new Date()) {
  const existing = await getActiveShift(userId);
  if (existing) throw new AppError("شیفت فعال شما از قبل آغاز شده است", 409);

  const settings = await getSettings();
  const shift = await prisma.shift.create({
    data: { userId, startedAt: now },
    include: { breaks: true },
  });
  await prisma.user.update({ where: { id: userId }, data: { status: "WORKING" } });
  const { awardCoins, COIN_RULES, touchStreak } = await import("@/services/gamification-service");
  await touchStreak(userId, now);
  await awardCoins(userId, COIN_RULES.SHIFT_STARTED, `SHIFT_START:${shift.id}`).catch(() => {});
  await ensureNextBreak(shift, settings, now);
  const { logAudit } = await import("@/lib/audit");
  await logAudit(userId, "SHIFT_START", `shift:${shift.id}`);
  publishStates([userId]);
  const { getEmployeeState } = await import("@/services/state-service");
  return getEmployeeState(userId, now);
}

export async function endShift(userId: string, now = new Date()) {
  const shift = await getActiveShift(userId);
  if (!shift) throw new AppError("شیفت فعالی برای پایان دادن وجود ندارد", 409);

  const settings = await getSettings();
  const open = shift.breaks[shift.breaks.length - 1];
  if (open && (open.status === "ACTIVE" || open.status === "OVERTIME") && open.actualStart) {
    // Closing the shift closes the running break with its FULL server-guaranteed
    // duration (never the elapsed wall-clock at shift end being cut short).
    const fixedEnd = addMinutes(open.actualStart, settings.breakDurationMinutes + open.extendMinutes);
    const endDelay = diffMinutes(now, fixedEnd);
    await prisma.break.updateMany({
      where: { id: open.id, actualEnd: null },
      data: {
        actualEnd: fixedEnd,
        durationMinutes: settings.breakDurationMinutes + open.extendMinutes,
        endDelayMinutes: endDelay,
        status: endDelay > 0 ? "LATE" : "COMPLETED",
      },
    });
  } else if (open && !open.actualStart && open.actualEnd === null && open.status === "SCHEDULED") {
    await prisma.break.updateMany({ where: { id: open.id, status: "SCHEDULED" }, data: { status: "CANCELLED" } });
  }

  await prisma.shift.update({ where: { id: shift.id }, data: { endedAt: now, status: "ENDED" } });
  await prisma.user.update({ where: { id: userId }, data: { status: "OFFLINE" } });
  // Any forming group containing this user must not block on them.
  await prisma.$transaction(async (tx) => {
    const memberships = await tx.groupBreakMember.findMany({
      where: { userId, groupBreak: { status: { in: ["FORMING", "DELAYED"] } } },
      include: { groupBreak: true },
    });
    for (const m of memberships) {
      const remaining = await tx.groupBreakMember.count({
        where: { groupBreakId: m.groupBreakId, userId: { not: userId } },
      });
      await tx.groupBreakMember.delete({ where: { id: m.id } });
      if (remaining === 0) {
        await tx.groupBreak.update({ where: { id: m.groupBreakId }, data: { status: "CANCELLED" } });
      }
    }
  }).catch(() => {});
  await prisma.break.updateMany({
    where: { userId, status: "SCHEDULED", shiftId: shift.id },
    data: { groupBreakId: null },
  });

  const done = shift.breaks.filter((b) => ["COMPLETED", "LATE"].includes(b.status));
  if (done.length > 0 && done.every((b) => b.endDelayMinutes === 0 && b.status === "COMPLETED")) {
    const { awardCoins, COIN_RULES } = await import("@/services/gamification-service");
    await awardCoins(userId, COIN_RULES.PERFECT_SHIFT, `PERFECT:${shift.id}`).catch(() => {});
  }
  const { logAudit } = await import("@/lib/audit");
  await logAudit(userId, "SHIFT_END", `shift:${shift.id} breaks:${done.length}`);
  const { getEmployeeState } = await import("@/services/state-service");
  const state = await getEmployeeState(userId, now);
  publishStates([userId]);
  return state;
}

export async function autoAdvance(shift: ShiftWithBreaks, now: Date): Promise<boolean> {
  // scheduledStart/scheduledEnd are only SUGGESTIONS: a SCHEDULED break never auto-starts,
  // never expires and is never skipped — it simply waits for the user's click.
  const active = shift.breaks.find((b) => b.status === "ACTIVE" || b.status === "OVERTIME");
  if (active && active.actualStart) {
    const settings = await getSettings();
    const effectiveEnd = addMinutes(active.actualStart, settings.breakDurationMinutes + active.extendMinutes);
    if (now > effectiveEnd) {
      await prisma.break.updateMany({
        where: { id: active.id, status: "ACTIVE", actualEnd: null },
        data: { status: "OVERTIME" },
      }).catch(() => {});
      await prisma.user.updateMany({
        where: { id: shift.userId, status: { not: "LATE" } },
        data: { status: "LATE" },
      });
    }
  }
  return false;
}

/** Fixed end of a break: ALWAYS full breakDuration from actualStart (server rule). */
export function effectiveBreakEnd(
  brk: { actualStart: Date | null },
  breakDurationMinutes: number,
): Date | null {
  return brk.actualStart ? addMinutes(brk.actualStart, breakDurationMinutes) : null;
}

export async function ensureNextBreak(
  shift: ShiftWithBreaks,
  settings: FullSettings,
  now: Date,
): Promise<void> {
  const running = shift.breaks.find(
    (b) => b.status === "SCHEDULED" || b.status === "ACTIVE" || b.status === "OVERTIME",
  );
  if (running) return;

  const last = shift.breaks[shift.breaks.length - 1];
  // Next work cycle starts from the ACTUAL end of the previous break
  // (a cancelled/skipped one falls back to its scheduled end).
  const anchor = last
    ? (last.actualEnd ?? last.scheduledEnd)
    : shift.startedAt;
  const idealStart =
    addMinutes(anchor, settings.workDurationMinutes) > now
      ? addMinutes(anchor, settings.workDurationMinutes)
      : now;
  const others = await prisma.break.findMany({
    where: {
      userId: { not: shift.userId },
      status: "SCHEDULED",
      scheduledEnd: { gt: now },
      shift: { status: "ACTIVE" },
    },
    select: { userId: true, scheduledStart: true, scheduledEnd: true },
  });
  const resolved = resolveBreakWithCapacity(
    { scheduledStart: idealStart, scheduledEnd: addMinutes(idealStart, settings.breakDurationMinutes) },
    others,
    shift.userId,
    settings,
  );
  await prisma.break.create({
    data: {
      shiftId: shift.id,
      userId: shift.userId,
      breakIndex: last ? last.breakIndex + 1 : 0,
      scheduledStart: resolved.scheduledStart,
      scheduledEnd: resolved.scheduledEnd,
      status: "SCHEDULED",
    },
  });
}

export function nextUserStatus(
  open: ShiftWithBreaks["breaks"][number] | undefined,
  now: Date,
  breakDurationMinutes: number,
): UserStatus {
  if (open?.status === "ACTIVE" && open.actualStart) {
    return now > addMinutes(open.actualStart, breakDurationMinutes) ? "LATE" : "ON_BREAK";
  }
  return "WORKING";
}

export function buildShiftReport(
  shift: {
    startedAt: Date;
    endedAt: Date | null;
    breaks: Array<{
      durationMinutes: number | null;
      endDelayMinutes: number;
      status: string;
    }>;
  },
  breakDurationMinutes: number,
  endedAt: Date,
): ShiftReport {
  const done = shift.breaks.filter((b) => ["COMPLETED", "LATE"].includes(b.status));
  const lateBreaks = done.filter((b) => b.endDelayMinutes > 0).length;
  return {
    startedAt: shift.startedAt,
    endedAt,
    shiftDurationMinutes: diffMinutes(endedAt, shift.startedAt),
    breakCount: done.length,
    allowedBreakMinutes: done.length * breakDurationMinutes,
    actualBreakMinutes: done.reduce((s, b) => s + (b.durationMinutes ?? 0), 0),
    totalDelayMinutes: done.reduce((s, b) => s + b.endDelayMinutes, 0),
    onTimeBreaks: done.length - lateBreaks,
    lateBreaks,
  };
}
