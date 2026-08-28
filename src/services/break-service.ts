import { prisma } from "@/lib/db";
import { AppError, diffMinutes, formatPersianTime } from "@/lib/utils";
import {
  calculateBreakDuration,
  calculateEndDelay,
  calculateStartDelay,
} from "@/services/break-scheduler";
import { getSettings } from "@/services/settings-service";
import {
  autoAdvance,
  ensureNextBreak,
  getActiveShift,
} from "@/services/shift-service";

export async function startBreak(userId: string, now = new Date()) {
  const settings = await getSettings();
  let shift = await getActiveShift(userId);
  if (!shift) throw new AppError("ابتدا شیفت خود را شروع کنید", 409);

  if (await autoAdvance(shift, now)) shift = (await getActiveShift(userId))!;
  await ensureNextBreak(shift, settings, now);
  shift = (await getActiveShift(userId))!;

  const open = shift.breaks[shift.breaks.length - 1];
  if (open?.status === "ACTIVE") throw new AppError("شما هم‌اکنون در استراحت هستید", 409);
  if (!open || open.status !== "SCHEDULED") {
    throw new AppError("استراحت برنامه‌ریزی‌شده‌ای برای شما وجود ندارد", 409);
  }
  // scheduledStart is a suggestion; user may start late. Still prevent early starts.
  if (now < open.scheduledStart) {
    throw new AppError(`زمان استراحت شما ساعت ${formatPersianTime(open.scheduledStart, settings.companyTimezone)} است`, 409);
  }

  const activeCount = await prisma.break.count({
    where: { actualStart: { not: null }, status: "ACTIVE" },
  });
  if (activeCount >= settings.maxConcurrentBreaks) {
    throw new AppError("ظرفیت استراحت همزمان تکمیل است؛ چند لحظه دیگر تلاش کنید", 409);
  }
n  // Determine delays and concrete actualEnd (10 minutes from actualStart)
  const startDelay = calculateStartDelay(open.scheduledStart, now);
  const plannedActualEnd = new Date(now.getTime() + settings.breakDurationMinutes * 60_000);
n  await prisma.break.update({
    where: { id: open.id },
    data: {
      actualStart: now,
      actualEnd: plannedActualEnd,
      status: "ACTIVE",
      startDelayMinutes: startDelay,
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { status: "ON_BREAK" } });
n  if (startDelay <= 1) {
    const { awardCoins, COIN_RULES } = await import("@/services/gamification-service");
    await awardCoins(userId, COIN_RULES.BREAK_ON_TIME, `BREAK_ONTIME:${open.id}`).catch(() => {});
  }
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(userId, { title: "☕ استراحت", body: "زمان استراحت شما شروع شد.", tag: "break-start", kind: "break-start", url: "/dashboard" }).catch(() => {});
  const { getEmployeeState } = await import("@/services/state-service");
  return getEmployeeState(userId, now);
}

export async function returnToWork(userId: string, now = new Date()) {
  const settings = await getSettings();
  const shift = await getActiveShift(userId);
  if (!shift) throw new AppError("شیفت فعالی ندارید", 409);
n  const open = shift.breaks.find((b) => b.status === "ACTIVE");
  if (!open) throw new AppError("در حال حاضر در استراحت نیستید", 409);
n  // Break duration is fixed from actualStart to actualEnd. If user attempts to return earlier, deny.
  if (open.actualEnd && now < open.actualEnd) {
    throw new AppError("استراحت شما هنوز به پایان نرسیده است", 409);
  }
n  // Use the recorded actualEnd (set at start) as the canonical end time for duration and delay calculations
  const actualEnd = open.actualEnd ?? now;
  const duration = open.actualStart ? calculateBreakDuration(open.actualStart, actualEnd) : diffMinutes(actualEnd, open.scheduledStart);
  const endDelay = calculateEndDelay(open.scheduledEnd, actualEnd);
n  await prisma.break.update({
    where: { id: open.id },
    data: {
      // keep actualEnd as plannedActualEnd (do not override with now)
      durationMinutes: duration,
      endDelayMinutes: endDelay,
      status: endDelay > 0 ? "LATE" : "COMPLETED",
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { status: "WORKING" } });
  if (endDelay === 0) {
    const { awardCoins, COIN_RULES } = await import("@/services/gamification-service");
    await awardCoins(userId, COIN_RULES.RETURN_ON_TIME, `RETURN_ONTIME:${open.id}`).catch(() => {});
  }
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(userId, { title: "💼 بازگشت به کار", body: "ثبت شد. موفق باشی!", tag: "return", kind: "break-end", url: "/dashboard" }).catch(() => {});
n  const fresh = (await getActiveShift(userId))!;
  await ensureNextBreak(fresh, settings, now);
  const { getEmployeeState } = await import("@/services/state-service");
  return getEmployeeState(userId, now);
}
