import { countConcurrentBreaks, addMinutes } from "@/lib/utils";
import type { ExistingBreakSlot, SchedulerSettings } from "@/types";

/**
 * Smart Break Buddy — decision layer, intentionally pure (no DB access here).
 *
 * Design rules (agreed scope):
 * 1. Suggestions NEVER reschedule anything: an employee's own break queue is
 *    untouched. The group slot search below is display-only and reuses the
 *    exact same primitives as the main scheduler (countConcurrentBreaks scan),
 *    so a suggested slot can never contradict the normal scheduling queue.
 * 2. Approval protects BOTH the hard capacity ceiling and a configurable
 *    load-ratio guard (share of online agents allowed on break).
 * 3. Everything downstream is optional: matching/approval may be declined
 *    without any consequence to the individual's normal break.
 */

export interface GroupBreakEvaluationInput {
  enabled: boolean;
  /** Members expected to break together (incl. requester). */
  groupSize: number;
  /** Employees currently on an active shift. */
  onlineAgents: number;
  /** Breaks currently running (ACTIVE/OVERTIME). */
  onBreakCount: number;
  settings: SchedulerSettings & { maxGroupBreakLoadRatio: number };
  /** Other agents' scheduled breaks — the same queue data the scheduler uses. */
  othersScheduled: ExistingBreakSlot[];
  from: Date;
  /** How far ahead a delayed slot may be searched (minutes). */
  searchMinutes?: number;
}

export type GroupBreakEvaluation =
  | { decision: "APPROVED" }
  | { decision: "DISABLED" }
  | {
      decision: "DELAYED";
      reason: "capacity" | "load";
      /** First minute where the whole group fits BOTH guards — display-only. */
      suggestedStart?: string;
      suggestedEnd?: string;
    };

export function evaluateGroupBreak(input: GroupBreakEvaluationInput): GroupBreakEvaluation {
  const { enabled, groupSize, onlineAgents, onBreakCount, settings } = input;
  if (!enabled) return { decision: "DISABLED" };

  const capacityOk = onBreakCount + groupSize <= settings.maxConcurrentBreaks;
  const loadOk =
    onlineAgents <= 0 ||
    (onBreakCount + groupSize) / onlineAgents <= settings.maxGroupBreakLoadRatio;

  if (capacityOk && loadOk) return { decision: "APPROVED" };

  const slot = findGroupSlot({
    groupSize,
    onlineAgents,
    settings,
    othersScheduled: input.othersScheduled,
    from: input.from,
    searchMinutes: input.searchMinutes,
  });
  return {
    decision: "DELAYED",
    reason: capacityOk ? "load" : "capacity",
    ...(slot
      ? {
          suggestedStart: slot.scheduledStart.toISOString(),
          suggestedEnd: slot.scheduledEnd.toISOString(),
        }
      : {}),
  };
}

export interface GroupSlotInput {
  groupSize: number;
  onlineAgents: number;
  settings: SchedulerSettings & { maxGroupBreakLoadRatio: number };
  othersScheduled: ExistingBreakSlot[];
  from: Date;
  searchMinutes?: number;
}

/**
 * First minute the whole group fits under BOTH the capacity ceiling and the
 * load-ratio guard. Future demand is modeled exactly like the main scheduler:
 * other agents' scheduled breaks overlapping the candidate window
 * (countConcurrentBreaks). Nothing is written to the DB here.
 */
export function findGroupSlot(input: GroupSlotInput): {
  scheduledStart: Date;
  scheduledEnd: Date;
} | null {
  const { groupSize, onlineAgents, settings, othersScheduled, from } = input;
  const searchMinutes = input.searchMinutes ?? 120;
  for (let i = 0; i <= searchMinutes; i++) {
    const start = addMinutes(from, i);
    const end = addMinutes(start, settings.breakDurationMinutes);
    const concurrent = countConcurrentBreaks(othersScheduled, start, end);
    const demand = concurrent + groupSize;
    if (demand <= settings.maxConcurrentBreaks) {
      const loadOk =
        onlineAgents <= 0 || demand / onlineAgents <= settings.maxGroupBreakLoadRatio;
      if (loadOk) return { scheduledStart: start, scheduledEnd: end };
    }
  }
  return null;
}

export interface BuddyMatch {
  userId: string;
  name: string;
  minutesUntilBreak: number;
  scheduledStart: string;
  scheduledEnd: string;
  isBuddy: boolean;
}

/**
 * Rank on-shift employees whose scheduled break starts within the suggest
 * window — "علی ۶ دقیقه دیگر Break دارد". Suggestion-only output; the caller
 * renders it as an offer the employee may ignore or decline.
 */
export function rankBreakMatches(
  candidates: Array<{
    userId: string;
    name: string;
    isBuddy: boolean;
    onCall: boolean;
    ready?: boolean;
    online?: boolean;
    shiftCompatible?: boolean;
    nextBreak?: { scheduledStart: Date; scheduledEnd: Date };
  }>,
  now: Date,
  windowMinutes: number,
): BuddyMatch[] {
  const limit = addMinutes(now, windowMinutes).getTime();
  return candidates
    .filter(
      (c) =>
        c.nextBreak &&
        !c.onCall &&
        c.online !== false &&
        c.nextBreak.scheduledStart.getTime() > now.getTime() &&
        c.nextBreak.scheduledStart.getTime() <= limit,
    )
    .map((c) => ({
      userId: c.userId,
      name: c.name,
      isBuddy: c.isBuddy,
      minutesUntilBreak: Math.max(
        0,
        Math.round((c.nextBreak!.scheduledStart.getTime() - now.getTime()) / 60_000),
      ),
      scheduledStart: c.nextBreak!.scheduledStart.toISOString(),
      scheduledEnd: c.nextBreak!.scheduledEnd.toISOString(),
      ready: c.ready ?? false,
      online: c.online ?? true,
      shiftCompatible: c.shiftCompatible ?? false,
    }))
    .sort(
      (a, b) =>
        a.minutesUntilBreak - b.minutesUntilBreak ||
        Number(b.ready ?? false) - Number(a.ready ?? false) ||
        Number(b.online ?? true) - Number(a.online ?? true) ||
        Number(b.shiftCompatible ?? false) - Number(a.shiftCompatible ?? false) ||
        Number(b.isBuddy) - Number(a.isBuddy),
    )
    .slice(0, 5);
}
