import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { addMinutes, AppError, diffMinutes } from "@/lib/utils";
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
  const { getEmployeeState } = await import("@/services/state-service");
  return getEmployeeState(userId, now);
}

export async function endShift(userId: string, now = new Date()) {
  const shift = await getActiveShift(userId);
  if (!shift) throw new AppError("شیفت فعالی برای پایان دادن وجود ندارد", 409);

  const open = shift.breaks[shift.breaks.length - 1];
  if (open?.status === "ACTIVE") {
    const endDelay = diffMinutes(now, open.scheduledEnd);
    await prisma.break.update({
      where: { id: open.id },
      data: {
        actualEnd: now,
        durationMinutes: open.actualStart ? diffMinutes(now, open.actualStart) : 0,
        endDelayMinutes: endDelay,
        status: endDelay > 0 ? "LATE" : "COMPLETED",
      },
    });
  } else if (open?.status === "SCHEDULED") {
    await prisma.break.update({ where: { id: open.id }, data: { status: "SKIPPED" } });
  }

  await prisma.shift.update({ where: { id: shift.id }, data: { endedAt: now, status: "ENDED" } });
  await prisma.user.update({ where: { id: userId }, data: { status: "OFFLINE" } });
  const done = shift.breaks.filter((b) => ["COMPLETED", "LATE"].includes(b.status));
  if (done.length > 0 && done.every((b) => b.endDelayMinutes === 0 && b.status === "COMPLETED")) {
    const { awardCoins, COIN_RULES } = await import("@/services/gamification-service");
    await awardCoins(userId, COIN_RULES.PERFECT_SHIFT, `PERFECT:${shift.id}`).catch(() => {});
  }
  const { getEmployeeState } = await import("@/services/state-service");
  return getEmployeeState(userId, now);
}

export async function autoAdvance(shift: ShiftWithBreaks, now: Date): Promise<boolean> {
  // Do not auto-skip scheduled breaks when scheduledEnd passes; user may start late and still receive full break.
  // Only update user status to LATE if an ACTIVE break's actualEnd has passed and the user wasn't marked late yet.
  const active = shift.breaks.find((b) => b.status === "ACTIVE");
  if (active && active.actualEnd && now > active.actualEnd) {
    await prisma.user.updateMany({
      where: { id: shift.userId, status: { not: "LATE" } },
      data: { status: "LATE" },
    });
    return false;
  }
  return false;
}

export async function ensureNextBreak(
  shift: ShiftWithBreaks,
  settings: FullSettings,
  now: Date,
): Promise<void> {
  const last = shift.breaks[shift.breaks.length - 1];
  if (last && (last.status === "SCHEDULED" || last.status === "ACTIVE")) return;

  const anchor = last ? (last.actualEnd ?? last.scheduledEnd) : shift.startedAt;
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

export function nextUserStatus(open: ShiftWithBreaks["breaks"][number] | undefined, now: Date): UserStatus {
  if (open?.status === "ACTIVE") return now > open.scheduledEnd ? "LATE" : "ON_BREAK";
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
