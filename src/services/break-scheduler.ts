import { addMinutes, countConcurrentBreaks, diffMinutes } from "@/lib/utils";
import type { BreakScheduleInput, ExistingBreakSlot, SchedulerSettings } from "@/types";

export function calculateIdealBreakTime(
  shiftStart: Date,
  breakIndex: number,
  settings: SchedulerSettings,
): BreakScheduleInput {
  const { workDurationMinutes, breakDurationMinutes } = settings;
  const scheduledStart = addMinutes(
    shiftStart,
    (breakIndex + 1) * workDurationMinutes + breakIndex * breakDurationMinutes,
  );
  return {
    scheduledStart,
    scheduledEnd: addMinutes(scheduledStart, breakDurationMinutes),
  };
}

export function calculateBreakSchedule(
  shiftStart: Date,
  breakCount: number,
  settings: SchedulerSettings,
): BreakScheduleInput[] {
  return Array.from({ length: breakCount }, (_, i) =>
    calculateIdealBreakTime(shiftStart, i, settings),
  );
}

export function resolveBreakWithCapacity(
  ideal: BreakScheduleInput,
  existingBreaks: ExistingBreakSlot[],
  requestingUserId: string,
  settings: SchedulerSettings,
): BreakScheduleInput {
  let candidateStart = new Date(ideal.scheduledStart);
  const others = existingBreaks.filter((b) => b.userId !== requestingUserId);

  for (let i = 0; i < 24 * 60; i++) {
    const candidateEnd = addMinutes(candidateStart, settings.breakDurationMinutes);
    if (
      countConcurrentBreaks(others, candidateStart, candidateEnd) <
      settings.maxConcurrentBreaks
    ) {
      return { scheduledStart: candidateStart, scheduledEnd: candidateEnd };
    }
    candidateStart = addMinutes(candidateStart, 1);
  }
  return ideal;
}

export function calculateEndDelay(scheduledEnd: Date, actualEnd: Date): number {
  return diffMinutes(actualEnd, scheduledEnd);
}

export function calculateStartDelay(scheduledStart: Date, actualStart: Date): number {
  return diffMinutes(actualStart, scheduledStart);
}

/**
 * Break start window (business rule):
 *  - before scheduledStart          → EARLY (rejected)
 *  - [scheduledStart, scheduledEnd) → ON_TIME (the same break is consumed)
 *  - from scheduledEnd onwards      → EXPIRED (rejected; next break is scheduled)
 * A SCHEDULED break is never auto-started, never skipped and never revived
 * after expiring — on every state visit it is finalised as EXPIRED and the
 * following break is computed from its window end.
 */
export const BREAK_START_GRACE_MINUTES = 0;

export type BreakStartStatus = "EARLY" | "ON_TIME" | "EXPIRED";

/** End of the start window: the last instant at which starting is allowed. */
export function startWindowEnd(scheduledEnd: Date): Date {
  return addMinutes(scheduledEnd, BREAK_START_GRACE_MINUTES);
}

export function calculateStartStatus(
  scheduledStart: Date,
  scheduledEnd: Date,
  now: Date,
): { status: BreakStartStatus; startDelayMinutes: number } {
  if (now < scheduledStart) return { status: "EARLY", startDelayMinutes: 0 };
  const startDelayMinutes = Math.max(0, calculateStartDelay(scheduledStart, now));
  if (now.getTime() < startWindowEnd(scheduledEnd).getTime()) {
    return { status: "ON_TIME", startDelayMinutes };
  }
  return { status: "EXPIRED", startDelayMinutes };
}

/** A SCHEDULED break whose start window has fully passed. */
export function isBreakWindowPassed(
  brk: { status: string; actualStart: Date | null; scheduledEnd: Date },
  now: Date,
): boolean {
  return brk.status === "SCHEDULED" && brk.actualStart === null && now.getTime() >= startWindowEnd(brk.scheduledEnd).getTime();
}


export function calculateBreakDuration(actualStart: Date, actualEnd: Date): number {
  return diffMinutes(actualEnd, actualStart);
}

export function shouldAutoActivateBreak(
  now: Date,
  scheduledStart: Date,
  scheduledEnd: Date,
): boolean {
  void now;
  void scheduledStart;
  void scheduledEnd;
  return false;
}

export function isBreakOverdue(now: Date, scheduledEnd: Date): boolean {
  return now > scheduledEnd;
}

export function estimateBreakCountForShift(
  shiftStart: Date,
  now: Date,
  settings: SchedulerSettings,
): number {
  const elapsed = diffMinutes(now, shiftStart);
  const cycle = settings.workDurationMinutes + settings.breakDurationMinutes;
  if (elapsed < settings.workDurationMinutes) return 1;
  return Math.floor((elapsed - settings.workDurationMinutes) / cycle) + 2;
}
