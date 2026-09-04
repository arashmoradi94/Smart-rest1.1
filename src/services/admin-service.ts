import { prisma } from "@/lib/db";
import { addMinutes, diffSeconds } from "@/lib/utils";
import { companyDayKey, companyHour } from "@/lib/time";
import { publishAll, publishStates } from "@/lib/events";
import { getSettings } from "@/services/settings-service";
import { getActiveShift } from "@/services/shift-service";
import type { AdminDashboardState, AdminEmployeeView, AuditRow, TeamAnalytics, UserStatus } from "@/types";

const STATUS_LABEL: Record<string, string> = {
  WORKING: "در حال کار",
  ON_BREAK: "در استراحت",
  ON_CALL: "در تماس",
  WAITING_BUDDY: "انتظار برای گروه",
  LATE: "تأخیر",
  EMERGENCY: "استراحت اضطراری",
  OFFLINE: "آفلاین",
};

export async function getAdminState(now = new Date()): Promise<AdminDashboardState> {
  const settings = await getSettings();
  const users = await prisma.user.findMany({
    where: { role: { not: "ADMIN" } },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, username: true, status: true, role: true,
      onCall: true, xp: true, level: true,
      coinTransactions: { select: { amount: true } },
    },
  });

  const links = await prisma.buddyLink.findMany();
  const buddyMap = new Map<string, string[]>();
  for (const l of links) {
    (buddyMap.get(l.aId) ?? buddyMap.set(l.aId, []).get(l.aId)!).push(l.bId);
    (buddyMap.get(l.bId) ?? buddyMap.set(l.bId, []).get(l.bId)!).push(l.aId);
  }

  const employees: AdminEmployeeView[] = await Promise.all(
    users.map(async (u) => {
      const shift = await getActiveShift(u.id);
      let status: UserStatus = (u.status as UserStatus) || "OFFLINE";
      let countdownSeconds = 0;
      let nextBreakAt: string | undefined;
      let currentBreak: AdminEmployeeView["currentBreak"];
      let shiftEndedAt: string | undefined;
      let totalBreakMinutes = 0;
      let breakCount = 0;
      let delayMinutes = 0;

      if (shift) {
        const open = shift.breaks[shift.breaks.length - 1];
        const done = shift.breaks.filter((b) => (b.status === "COMPLETED" || b.status === "LATE") && b.kind !== "EMERGENCY");
        totalBreakMinutes = done.reduce((s, b) => s + (b.durationMinutes ?? 0), 0);
        breakCount = done.length;

        if (open?.kind === "EMERGENCY" && open.status === "ACTIVE" && open.actualStart) {
          status = "EMERGENCY";
          currentBreak = {
            id: open.id,
            scheduledStart: open.scheduledStart.toISOString(),
            scheduledEnd: open.scheduledEnd.toISOString(),
            actualStart: open.actualStart.toISOString(),
            endsAt: now.toISOString(),
            durationMinutes: Math.max(0, Math.round((now.getTime() - open.actualStart.getTime()) / 60_000)),
            group: false,
            kind: "EMERGENCY",
            emergencyReason: open.emergencyReason as "RESTROOM" | "ILLNESS" | "URGENT_REST" | "OTHER",
            emergencyNote: open.emergencyNote ?? undefined,
          };
          countdownSeconds = Math.max(0, Math.round((now.getTime() - open.actualStart.getTime()) / 1000));
        } else if (open && (open.status === "ACTIVE" || open.status === "OVERTIME") && open.actualStart) {
          const endsAt = addMinutes(open.actualStart, settings.breakDurationMinutes + open.extendMinutes);
          status = now > endsAt ? "LATE" : "ON_BREAK";
          currentBreak = {
            id: open.id,
            scheduledStart: open.scheduledStart.toISOString(),
            scheduledEnd: open.scheduledEnd.toISOString(),
            actualStart: open.actualStart.toISOString(),
            endsAt: endsAt.toISOString(),
            durationMinutes: settings.breakDurationMinutes + open.extendMinutes,
            startDelayMinutes: open.startDelayMinutes,
            group: !!open.groupBreakId,
          };
          delayMinutes = open.startDelayMinutes;
          countdownSeconds = diffSeconds(endsAt, now);
        } else {
          // The scheduled break can sit BEFORE a completed emergency break in
          // the index order — find it wherever it is (see state-service).
          const scheduled = shift.breaks.find((b) => b.status === "SCHEDULED" && b.kind !== "EMERGENCY");
          if (scheduled) {
            status = u.onCall ? "ON_CALL" : "WORKING";
            nextBreakAt = scheduled.scheduledStart.toISOString();
            countdownSeconds = diffSeconds(scheduled.scheduledStart, now);
          }
        }
        if (!currentBreak) delayMinutes = done.reduce((sum, b) => sum + b.endDelayMinutes, 0);
      } else {
        const last = await prisma.shift.findFirst({
          where: { userId: u.id, status: "ENDED" },
          orderBy: { endedAt: "desc" },
          select: { endedAt: true },
        });
        shiftEndedAt = last?.endedAt?.toISOString();
      }

      return {
        id: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
        status,
        statusLabel: STATUS_LABEL[status] ?? status,
        onCall: u.onCall,
        breakInfo: currentBreak ? "در استراحت" : nextBreakAt ? "برنامه‌ریزی شده" : "—",
        delayMinutes,
        shiftStartedAt: shift?.startedAt.toISOString(),
        shiftEndedAt,
        nextBreakAt,
        currentBreak,
        totalBreakMinutes,
        breakCount,
        countdownSeconds: Math.max(0, countdownSeconds),
        buddies: (buddyMap.get(u.id) ?? []).sort(),
        coins: u.coinTransactions.reduce((s, t) => s + t.amount, 0),
        xp: u.xp,
        level: u.level,
      };
    }),
  );

  const activeBreaks = await prisma.break.count({
    where: { actualStart: { not: null }, actualEnd: null },
  });

  // Break forecast: scheduled breaks of on-shift users starting soon.
  const soon = new Date(now.getTime() + 60 * 60 * 1000);
  const upcoming = await prisma.break.findMany({
    where: {
      status: "SCHEDULED",
      scheduledStart: { gte: new Date(now.getTime() - 5 * 60_000), lte: soon },
      shift: { status: "ACTIVE" },
    },
    orderBy: { scheduledStart: "asc" },
    include: { user: { select: { id: true, name: true } } },
  });
  const forecast = upcoming.map((b) => ({
    userId: b.userId,
    name: b.user.name,
    scheduledStart: b.scheduledStart.toISOString(),
    minutesAway: Math.max(0, Math.round((b.scheduledStart.getTime() - now.getTime()) / 60_000)),
  }));

  const stats = {
    total: employees.length,
    working: employees.filter((e) => e.status === "WORKING").length,
    onBreak: employees.filter((e) => e.status === "ON_BREAK").length,
    onCall: employees.filter((e) => e.onCall && e.status !== "OFFLINE").length,
    waitingBuddy: employees.filter((e) => e.status === "WAITING_BUDDY").length,
    late: employees.filter((e) => e.status === "LATE").length,
    offline: employees.filter((e) => e.status === "OFFLINE").length,
    activeBreaks,
    remainingCapacity: Math.max(0, settings.maxConcurrentBreaks - activeBreaks),
  };

  return { serverTime: now.toISOString(), timezone: settings.timezone, stats, employees, settings, forecast };
}

export async function adminUpdateSettings(adminId: string, input: Record<string, unknown>) {
  const allowed: Array<[string, "number" | "boolean" | "timezone"]> = [
    ["workDurationMinutes", "number"],
    ["breakDurationMinutes", "number"],
    ["maxConcurrentBreaks", "number"],
    ["earlyNotificationMinutes", "number"],
    ["endNotificationMinutes", "number"],
    ["timezone", "timezone"],
    ["groupBreakEnabled", "boolean"],
    ["groupSuggestWindowMinutes", "number"],
    ["maxGroupBreakLoadRatio", "number"],
  ];
  const filtered: Record<string, unknown> = {};
  for (const [k, kind] of allowed) {
    if (!(k in input)) continue;
    if (kind === "timezone") {
      if (typeof input[k] === "string" && input[k].includes("/")) filtered[k] = input[k];
    } else if (kind === "boolean") {
      if (typeof input[k] === "boolean") filtered[k] = input[k];
    } else if (typeof input[k] === "number" && input[k] > 0) {
      filtered[k] = input[k];
    }
  }
  const { updateSettings } = await import("@/services/settings-service");
  const result = await updateSettings(filtered);
  const { logAudit } = await import("@/lib/audit");
  await logAudit(adminId, "UPDATE_SETTINGS", JSON.stringify(filtered));
  publishAll("settings");
  return result;
}

export async function adminCreateUser(
  adminId: string,
  name: string,
  username: string,
  password: string,
  role: string,
) {
  if (!["EMPLOYEE", "SUPERVISOR", "ADMIN"].includes(role)) role = "EMPLOYEE";
  if (password.length < 6) {
    const { AppError } = await import("@/lib/utils");
    throw new AppError("رمز عبور باید حداقل ۶ کاراکتر باشد", 400);
  }
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name: name.trim(), username: username.trim(), passwordHash: hash, role } });
  const { logAudit } = await import("@/lib/audit");
  await logAudit(adminId, "CREATE_USER", `${username} (${role})`);
  publishStates([user.id]);
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

export async function adminOverrideBreak(
  adminId: string,
  userId: string,
  action: "start" | "return" | "end-shift",
) {
  const shift = await getActiveShift(userId);
  const { AppError } = await import("@/lib/utils");
  if (!shift) throw new AppError("شیفت فعالی برای این کاربر وجود ندارد", 404);
  const { logAudit } = await import("@/lib/audit");
  const { sendPushToUser } = await import("@/lib/push");
  let result;
  if (action === "start") {
    const { startBreak } = await import("@/services/break-service");
    result = await startBreak(userId, new Date(), { force: true });
    await logAudit(adminId, "OVERRIDE_BREAK_START", userId);
    sendPushToUser(userId, {
      title: "☕ استراحت توسط مدیر شروع شد",
      body: "مدیر شما استراحت را هم‌اکنون آغاز کرد.",
      tag: "override",
      kind: "break-start",
      url: "/dashboard",
    }).catch(() => {});
  } else if (action === "return") {
    const { returnToWork } = await import("@/services/break-service");
    result = await returnToWork(userId);
    await logAudit(adminId, "OVERRIDE_BREAK_RETURN", userId);
    sendPushToUser(userId, {
      title: "💼 بازگشت به کار توسط مدیر ثبت شد",
      body: "استراحت شما توسط مدیر پایان یافت.",
      tag: "override",
      kind: "break-end",
      url: "/dashboard",
    }).catch(() => {});
  } else {
    const { endShift } = await import("@/services/shift-service");
    result = await endShift(userId);
    await logAudit(adminId, "OVERRIDE_END_SHIFT", userId);
    sendPushToUser(userId, {
      title: "🏁 شیفت شما توسط مدیر پایان یافت",
      body: "شیفت شما بسته شد؛ روز خوبی بود!",
      tag: "override",
      kind: "announcement",
      url: "/dashboard",
    }).catch(() => {});
  }
  return result;
}
/** Admin: change a user's role with last-admin protection. */
export async function adminUpdateUserRole(
  adminId: string,
  userId: string,
  role: "EMPLOYEE" | "SUPERVISOR" | "ADMIN",
) {
  const { AppError } = await import("@/lib/utils");
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new AppError("کاربر یافت نشد", 404);
  if (target.id === adminId && role !== "ADMIN") {
    throw new AppError("نمی‌توانید نقش خودتان را تنزل دهید", 403);
  }
  if (target.role === "ADMIN" && role !== "ADMIN") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) throw new AppError("حداقل یک مدیر باید باقی بماند", 409);
  }
  await prisma.user.update({ where: { id: userId }, data: { role } });
  const { logAudit } = await import("@/lib/audit");
  await logAudit(adminId, "UPDATE_ROLE", `${target.username}: ${target.role} → ${role}`);
  publishStates([userId]);
  return { ok: true as const };
}

/** Per-user shift+break history for the admin panel. */
export async function getUserHistory(
  userId: string,
  opts?: { from?: Date; to?: Date; status?: string[] },
) {
  const shifts = await prisma.shift.findMany({
    where: {
      userId,
      ...(opts?.from || opts?.to
        ? { startedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    },
    orderBy: { startedAt: "desc" },
    take: 30,
    include: {
      breaks: {
        where: opts?.status?.length ? { status: { in: opts.status } } : undefined,
        orderBy: { breakIndex: "asc" },
      },
    },
  });
  return shifts.map((s) => ({
    id: s.id,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString(),
    status: s.status,
    breaks: s.breaks.map((b) => ({
      id: b.id,
      breakIndex: b.breakIndex,
      scheduledStart: b.scheduledStart.toISOString(),
      scheduledEnd: b.scheduledEnd.toISOString(),
      actualStart: b.actualStart?.toISOString(),
      actualEnd: b.actualEnd?.toISOString(),
      durationMinutes: b.durationMinutes,
      startDelayMinutes: b.startDelayMinutes,
      endDelayMinutes: b.endDelayMinutes,
      status: b.status,
      group: !!b.groupBreakId,
    })),
  }));
}

export async function listAudit(limit = 100): Promise<AuditRow[]> {
  const rowsRaw = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, limit)),
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rowsRaw.map((r) => r.userId))] } },
    select: { id: true, name: true },
  });
  const nameOf = Object.fromEntries(users.map((u) => [u.id, u.name]));
  return rowsRaw.map((r) => ({
    id: r.id,
    userName: nameOf[r.userId] ?? r.userId,
    action: r.action,
    details: r.details ?? undefined,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Team analytics over day/week/month with company-timezone buckets. */
export async function getTeamAnalytics(
  period: "day" | "week" | "month",
  now = new Date(),
): Promise<TeamAnalytics> {
  const settings = await getSettings();
  const days = period === "day" ? 1 : period === "week" ? 7 : 30;
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);

  const [shifts, breaks] = await Promise.all([
    prisma.shift.findMany({
      where: { startedAt: { gte: since } },
      select: { id: true, userId: true, startedAt: true, endedAt: true, status: true },
    }),
    prisma.break.findMany({
      where: {
        shift: { startedAt: { gte: since } },
        status: { in: ["COMPLETED", "LATE"] },
        // Emergency breaks are tracked separately — they never blend into the
        // regular break metrics (duration/latency/peaks).
        kind: { not: "EMERGENCY" },
      },
      select: {
        userId: true, durationMinutes: true, endDelayMinutes: true, actualStart: true, status: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  const workMinutes = shifts.reduce((s, sh) => {
    if (!sh.endedAt) return s;
    return s + Math.max(0, (sh.endedAt.getTime() - sh.startedAt.getTime()) / 60_000);
  }, 0);
  const totalBreakMinutes = breaks.reduce((s, b) => s + (b.durationMinutes ?? 0), 0);
  const totalDelay = breaks.reduce((s, b) => s + b.endDelayMinutes, 0);
  const onTime = breaks.filter((b) => b.endDelayMinutes === 0 && b.status === "COMPLETED").length;
  const attendance = new Set(shifts.map((s) => s.userId)).size;

  // Peak break times by company-timezone hour
  const hours = Array(24).fill(0) as number[];
  for (const b of breaks) {
    if (b.actualStart) hours[companyHour(b.actualStart, settings.timezone)]++;
  }

  // Capacity usage: average active-break load sampled per break duration
  const capacityUsagePercent =
    settings.maxConcurrentBreaks > 0
      ? Math.min(100, Math.round((totalBreakMinutes / (days * 24 * 60) / settings.maxConcurrentBreaks) * 100))
      : 0;

  // Per-employee rollup
  const byUser = new Map<string, { name: string; shifts: number; workMinutes: number; breakCount: number; breakMinutes: number; delayMinutes: number; onTime: number }>();
  for (const sh of shifts) {
    const row = byUser.get(sh.userId) ?? { name: "", shifts: 0, workMinutes: 0, breakCount: 0, breakMinutes: 0, delayMinutes: 0, onTime: 0 };
    if (sh.status === "ENDED" && sh.endedAt) {
      row.shifts += 1;
      row.workMinutes += Math.max(0, (sh.endedAt.getTime() - sh.startedAt.getTime()) / 60_000);
    }
    byUser.set(sh.userId, row);
  }
  for (const b of breaks) {
    const row = byUser.get(b.userId);
    if (!row) continue;
    row.breakCount += 1;
    row.breakMinutes += b.durationMinutes ?? 0;
    row.delayMinutes += b.endDelayMinutes;
    if (b.endDelayMinutes === 0 && b.status === "COMPLETED") row.onTime += 1;
  }
  const names = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, name: true },
  });
  const nameOf = Object.fromEntries(names.map((n) => [n.id, n.name]));

  // Daily buckets (heatmap-ready)
  const dailyMap = new Map<string, { breakMinutes: number; breakCount: number }>();
  for (const b of breaks) {
    if (!b.actualStart) continue;
    const key = companyDayKey(b.actualStart, settings.timezone);
    const row = dailyMap.get(key) ?? { breakMinutes: 0, breakCount: 0 };
    row.breakMinutes += b.durationMinutes ?? 0;
    row.breakCount += 1;
    dailyMap.set(key, row);
  }
  const dailyBuckets = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, ...v }));

  return {
    period,
    totalWorkMinutes: Math.round(workMinutes),
    totalBreakMinutes,
    avgBreakMinutes: breaks.length ? Math.round(totalBreakMinutes / breaks.length) : 0,
    avgDelayMinutes: breaks.length ? Math.round(totalDelay / breaks.length) : 0,
    onTimePercent: breaks.length ? Math.round((onTime / breaks.length) * 100) : 100,
    attendanceCount: attendance,
    breakCount: breaks.length,
    peakTimes: hours.map((count, hour) => ({ hour, count })),
    capacityUsagePercent,
    employees: [...byUser.entries()].map(([userId, r]) => ({
      userId,
      name: nameOf[userId] ?? userId,
      shifts: r.shifts,
      workMinutes: Math.round(r.workMinutes),
      breakCount: r.breakCount,
      breakMinutes: r.breakMinutes,
      delayMinutes: r.delayMinutes,
      onTimePercent: r.breakCount ? Math.round((r.onTime / r.breakCount) * 100) : 100,
    })),
    dailyBuckets,
  };
}
