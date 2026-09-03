import { prisma } from "@/lib/db";
import { addMinutes } from "@/lib/utils";
import { getSettings } from "@/services/settings-service";
import { publishStates } from "@/lib/events";

/**
 * Server-side reminder sweep. The in-app client timers only work while the
 * dashboard is open; this job delivers early-warning / end-warning / overdue
 * pushes for breaks regardless — flagged per break (notifiedEarlyAt, …) so
 * every reminder fires exactly once, race-safe via conditional updateMany.
 */

const SWEEP_INTERVAL_MS = 30_000;

export interface ReminderSweepResult {
  early: number;
  endWarn: number;
  overdue: number;
}

/** One sweep: find due reminders, claim them atomically, push. */
export async function runReminderSweep(now = new Date()): Promise<ReminderSweepResult> {
  const settings = await getSettings();
  const result: ReminderSweepResult = { early: 0, endWarn: 0, overdue: 0 };
  const { sendPushToUser } = await import("@/lib/push");

  // 1) Early warning for upcoming SCHEDULED breaks
  const earlyWindow = new Date(now.getTime() + settings.earlyNotificationMinutes * 60_000);
  const upcoming = await prisma.break.findMany({
    where: {
      status: "SCHEDULED",
      actualStart: null,
      notifiedEarlyAt: null,
      scheduledStart: { lte: earlyWindow },
      shift: { status: "ACTIVE" },
    },
    select: { id: true, userId: true, scheduledStart: true, groupBreakId: true },
  });
  for (const b of upcoming) {
    const claim = await prisma.break.updateMany({
      where: { id: b.id, notifiedEarlyAt: null, status: "SCHEDULED", actualStart: null },
      data: { notifiedEarlyAt: now },
    });
    if (claim.count !== 1) continue;
    const mins = Math.max(1, Math.round((b.scheduledStart.getTime() - now.getTime()) / 60_000));
    // Group-coordinated break gets a group-flavored heads-up
    const inFormingGroup =
      !!b.groupBreakId &&
      (await prisma.groupBreak
        .count({ where: { id: b.groupBreakId, status: { in: ["FORMING", "DELAYED"] } } })
        .catch(() => 0)) > 0;
    await sendPushToUser(b.userId, inFormingGroup
      ? {
          title: "☕ استراحت گروهی نزدیک است",
          body: `هماهنگی گروه آماده می‌شود؛ حدود ${mins.toLocaleString("fa-IR")} دقیقه دیگر.`,
          tag: `early:${b.id}`,
          kind: "reminder",
          url: "/dashboard",
        }
      : {
          title: "☕ زمان استراحت نزدیک است",
          body: `تا شروع استراحت شما حدود ${mins.toLocaleString("fa-IR")} دقیقه باقی مانده.`,
          tag: `early:${b.id}`,
          kind: "reminder",
          url: "/dashboard",
        }).catch(() => {});
    result.early++;
  }

  // 2) End warning + overdue for running breaks (full fixed duration + extension)
  const running = await prisma.break.findMany({
    where: {
      status: { in: ["ACTIVE", "OVERTIME"] },
      actualStart: { not: null },
      actualEnd: null,
      OR: [{ notifiedEndWarnAt: null }, { notifiedOverdueAt: null }],
    },
    select: {
      id: true, userId: true, actualStart: true, extendMinutes: true,
      notifiedEndWarnAt: true, notifiedOverdueAt: true,
    },
  });
  for (const b of running) {
    const fixedEnd = addMinutes(b.actualStart!, settings.breakDurationMinutes + b.extendMinutes);
    const msLeft = fixedEnd.getTime() - now.getTime();

    if (msLeft <= 0) {
      if (b.notifiedOverdueAt) continue;
      const claim = await prisma.break.updateMany({
        where: { id: b.id, notifiedOverdueAt: null, actualEnd: null },
        data: { notifiedOverdueAt: now },
      });
      if (claim.count !== 1) continue;
      await sendPushToUser(b.userId, {
        title: "🔴 پایان استراحت",
        body: "زمان استراحت شما تمام شد. لطفاً به کار برگردید.",
        tag: `overdue:${b.id}`,
        kind: "break-end",
        url: "/dashboard",
      }).catch(() => {});
      result.overdue++;
    } else if (msLeft <= settings.endNotificationMinutes * 60_000) {
      if (b.notifiedEndWarnAt) continue;
      const claim = await prisma.break.updateMany({
        where: { id: b.id, notifiedEndWarnAt: null, actualEnd: null },
        data: { notifiedEndWarnAt: now },
      });
      if (claim.count !== 1) continue;
      const mins = Math.max(1, Math.round(msLeft / 60_000));
      await sendPushToUser(b.userId, {
        title: "⚠️ پایان استراحت نزدیک است",
        body: `فقط ${mins.toLocaleString("fa-IR")} دقیقه تا پایان استراحت شما باقی مانده.`,
        tag: `endwarn:${b.id}`,
        kind: "reminder",
        url: "/dashboard",
      }).catch(() => {});
      result.endWarn++;
    }
  }

  if (result.overdue > 0) {
    // Overtime changes what the admin panel shows (LATE state)
    publishStates([]);
  }
  return result;
}

const SCHEDULER_KEY = Symbol.for("callcenter.reminder-scheduler");

/**
 * Lazily start the background sweep timer on the first qualifying request.
 * Single-node, unref'd so it never keeps the process alive on its own.
 */
export function ensureReminderScheduler(): void {
  const g = globalThis as Record<symbol, boolean | undefined>;
  if (g[SCHEDULER_KEY]) return;
  g[SCHEDULER_KEY] = true;
  const timer = setInterval(() => {
    runReminderSweep().catch((err) => console.error("[reminders]", err));
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}
