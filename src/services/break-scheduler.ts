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
