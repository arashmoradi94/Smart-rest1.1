import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { buildDinnerSlots, saveDinnerSchedule, getDinnerSchedule } from "@/services/dinner-service";

describe("buildDinnerSlots", () => {
  it("creates contiguous 20-minute slots", () => {
    expect(buildDinnerSlots("19:40", "20:40")).toEqual([
      { startTime: "19:40", endTime: "20:00" },
      { startTime: "20:00", endTime: "20:20" },
      { startTime: "20:20", endTime: "20:40" },
    ]);
  });

  it("rejects ranges that are not a positive multiple of 20 minutes", () => {
    expect(() => buildDinnerSlots("20:00", "20:10")).toThrow();
    expect(() => buildDinnerSlots("20:00", "19:40")).toThrow();
  });

  it("rejects invalid clock values", () => {
    expect(() => buildDinnerSlots("25:00", "26:00")).toThrow();
  });
});

/**
 * Auto dinner stability (acceptance item 6): every employee gets ONE fixed
 * dinner time for the whole month — day 1, 5, 15 and 30 are identical — and
 * regenerating the schedule never moves it.
 */
describe("auto dinner: fixed time per employee per month (temp db)", () => {
  process.env.DATABASE_URL = "file:./tmp-test-dinner.db";

  beforeAll(async () => {
    for (const ext of ["", "-wal", "-shm"]) {
      if (fs.existsSync(`dev.db${ext}`)) fs.copyFileSync(`dev.db${ext}`, `tmp-test-dinner.db${ext}`);
    }
    const db = await import("@/lib/db");
    await db.prisma.dinnerAssignment.deleteMany({});
    await db.prisma.dinnerSchedule.deleteMany({});
  });

  afterAll(async () => {
    const db = await import("@/lib/db");
    await db.prisma.$disconnect();
    for (const ext of ["", "-wal", "-shm"]) {
      try {
        if (fs.existsSync(`tmp-test-dinner.db${ext}`)) fs.rmSync(`tmp-test-dinner.db${ext}`);
      } catch {
        // Windows may hold the file briefly
      }
    }
  });

  it("day 1/5/15/30 all have the SAME time for each employee; re-run changes nothing", async () => {
    const first = await saveDinnerSchedule({
      monthKey: "2026-09",
      mode: "AUTO",
      startTime: "19:00",
      endTime: "20:00",
    });
    expect(first).toBeTruthy();
    const byUser = new Map<string, Set<string>>();
    for (const a of first!.assignments) {
      if (!byUser.has(a.userId)) byUser.set(a.userId, new Set());
      byUser.get(a.userId)!.add(`${a.startTime}-${a.endTime}`);
    }
    expect(byUser.size).toBeGreaterThan(0);
    for (const [userId, times] of byUser) {
      expect(times.size, `user ${userId} must keep one time all month`).toBe(1);
    }
    // explicit day checks: 1st, 5th, 15th, 30th identical per employee
    const timeOn = (schedule: NonNullable<Awaited<ReturnType<typeof getDinnerSchedule>>>, userId: string, date: string) =>
      schedule.assignments.find((a) => a.userId === userId && a.date === date);
    const sampleUser = first!.assignments[0].userId;
    const d1 = timeOn(first!, sampleUser, "2026-09-01")!;
    for (const day of ["05", "15", "30"]) {
      const a = timeOn(first!, sampleUser, `2026-09-${day}`)!;
      expect(`${a.startTime}-${a.endTime}`).toBe(`${d1.startTime}-${d1.endTime}`);
    }
    // different employees may have different times (at least 2 distinct slots)
    const distinctTimes = new Set(first!.assignments.map((a) => `${a.startTime}-${a.endTime}`));
    expect(distinctTimes.size).toBeGreaterThanOrEqual(2);

    // re-running the algorithm (refresh/restart equivalent) → same schedule
    const second = await saveDinnerSchedule({
      monthKey: "2026-09",
      mode: "AUTO",
      startTime: "19:00",
      endTime: "20:00",
    });
    expect(second!.assignments.map((a) => `${a.userId}|${a.date}|${a.startTime}`))
      .toEqual(first!.assignments.map((a) => `${a.userId}|${a.date}|${a.startTime}`));
    // only ONE schedule row exists for the month (no duplicates)
    const db = await import("@/lib/db");
    expect(await db.prisma.dinnerSchedule.count({ where: { monthKey: "2026-09" } })).toBe(1);
  });

  it("next month may differ from this month (per-month value)", async () => {
    const sept = await saveDinnerSchedule({ monthKey: "2026-09", mode: "AUTO", startTime: "19:00", endTime: "20:00" });
    const oct = await saveDinnerSchedule({ monthKey: "2026-10", mode: "AUTO", startTime: "19:00", endTime: "20:00" });
    const u = sept!.assignments[0].userId;
    const septTime = sept!.assignments.find((a) => a.userId === u && a.date === "2026-09-01")!;
    const octTime = oct!.assignments.find((a) => a.userId === u && a.date === "2026-10-01")!;
    // with 3 slots and the month offset, October must rotate for this user
    expect(octTime.startTime).not.toBe(septTime.startTime);
  });
});
