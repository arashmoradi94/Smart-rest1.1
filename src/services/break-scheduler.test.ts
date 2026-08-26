import { describe, expect, it } from "vitest";
import {
  calculateBreakSchedule,
  calculateEndDelay,
  calculateIdealBreakTime,
  resolveBreakWithCapacity,
} from "@/services/break-scheduler";
import type { ExistingBreakSlot, SchedulerSettings } from "@/types";

const settings: SchedulerSettings = {
  workDurationMinutes: 60,
  breakDurationMinutes: 10,
  maxConcurrentBreaks: 5,
};

const at = (h: number, m = 0) => new Date(2026, 7, 18, h, m, 0, 0);

describe("BreakScheduler", () => {
  it("Test 1: start 08:00 => break 09:00-09:10", () => {
    const first = calculateIdealBreakTime(at(8), 0, settings);
    expect(first.scheduledStart).toEqual(at(9));
    expect(first.scheduledEnd).toEqual(at(9, 10));
  });

  it("Test 2: next break 10:10-10:20", () => {
    const second = calculateIdealBreakTime(at(8), 1, settings);
    expect(second.scheduledStart).toEqual(at(10, 10));
    expect(second.scheduledEnd).toEqual(at(10, 20));
  });

  it("Test 3: return at 09:13 => delay 3 min", () => {
    expect(calculateEndDelay(at(9, 10), at(9, 13))).toBe(3);
  });

  it("Test 5: delays when capacity full", () => {
    const ideal = { scheduledStart: at(10), scheduledEnd: at(10, 10) };
    const existing: ExistingBreakSlot[] = Array.from({ length: 5 }, (_, i) => ({
      userId: `u${i}`,
      scheduledStart: at(9, 55),
      scheduledEnd: at(10, 15),
    }));
    const resolved = resolveBreakWithCapacity(ideal, existing, "new", settings);
    expect(resolved.scheduledStart.getTime()).toBeGreaterThan(ideal.scheduledStart.getTime());
  });

  it("builds schedule from shift start 15:17", () => {
    const schedule = calculateBreakSchedule(at(15, 17), 3, settings);
    expect(schedule[0].scheduledStart).toEqual(at(16, 17));
    expect(schedule[1].scheduledStart).toEqual(at(17, 27));
  });
});
