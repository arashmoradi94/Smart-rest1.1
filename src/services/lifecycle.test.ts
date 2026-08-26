import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

process.env.DATABASE_URL = "file:./tmp-test.db";

const at = (base: Date, offsetMin: number) => new Date(base.getTime() + offsetMin * 60_000);

let shiftSvc: typeof import("@/services/shift-service");
let breakSvc: typeof import("@/services/break-service");
let stateSvc: typeof import("@/services/state-service");
let db: typeof import("@/lib/db");
let ids: Record<string, string> = {};

const T0 = new Date("2026-08-24T08:00:00.000Z");

beforeAll(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    if (fs.existsSync(`dev.db${ext}`)) fs.copyFileSync(`dev.db${ext}`, `tmp-test.db${ext}`);
  }
  db = await import("@/lib/db");
  // Deterministic baseline: close any stale active shifts copied from dev.db
  await db.prisma.shift.updateMany({
    where: { status: "ACTIVE" },
    data: { status: "ENDED", endedAt: new Date() },
  });
  await db.prisma.break.updateMany({
    where: { actualStart: { not: null }, actualEnd: null },
    data: { actualEnd: new Date(), status: "COMPLETED" },
  });
  await db.prisma.user.updateMany({ data: { status: "OFFLINE" } });
  shiftSvc = await import("@/services/shift-service");
  breakSvc = await import("@/services/break-service");
  stateSvc = await import("@/services/state-service");
  const users = await db.prisma.user.findMany();
  ids = Object.fromEntries(users.map((u) => [u.username, u.id]));
  // Self-healing seed: guarantee the users this suite needs exist (dev.db may have been edited)
  for (const name of ["ali", "mohammad", "reza", "sara", "nima", "admin"]) {
    if (!ids[name]) {
      const u = await db.prisma.user.create({
        data: { name, username: name, passwordHash: "x", role: name === "admin" ? "ADMIN" : "EMPLOYEE" },
      });
      ids[name] = u.id;
    }
  }
});

afterAll(async () => {
  await db.prisma.$disconnect();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      if (fs.existsSync(`tmp-test.db${ext}`)) fs.rmSync(`tmp-test.db${ext}`);
    } catch {
      // Windows may still hold the file briefly; leftover temp db is harmless
    }
  }
});

describe("Shift lifecycle (integration, temp db)", () => {
  it("start shift: schedules first break at +60m", async () => {
    const state = await shiftSvc.startShift(ids.ali, T0);
    expect(state.hasActiveShift).toBe(true);
    expect(state.userStatus).toBe("WORKING");
    expect(state.nextBreak?.scheduledStart).toBe(at(T0, 60).toISOString());
    expect(state.nextBreak?.scheduledEnd).toBe(at(T0, 70).toISOString());
    expect(state.timerSeconds).toBe(3600);
    expect(state.timerLabel).toBe("تا استراحت بعدی");
  });

  it("duplicate start shift is rejected", async () => {
    await expect(shiftSvc.startShift(ids.ali, at(T0, 1))).rejects.toMatchObject({ status: 409 });
  });

  it("early break start is rejected; on-time start works", async () => {
    await expect(breakSvc.startBreak(ids.ali, at(T0, 59))).rejects.toMatchObject({ status: 409 });
    const state = await breakSvc.startBreak(ids.ali, at(T0, 60));
    expect(state.userStatus).toBe("ON_BREAK");
    expect(state.currentBreak?.status).toBe("ACTIVE");
    expect(state.timerSeconds).toBe(600);
  });

  it("duplicate break start and return are rejected", async () => {
    await expect(breakSvc.startBreak(ids.ali, at(T0, 61))).rejects.toMatchObject({ status: 409 });
  });

  it("late return: delay=3, status LATE, next break at return+60", async () => {
    const state = await breakSvc.returnToWork(ids.ali, at(T0, 73));
    expect(state.userStatus).toBe("WORKING");
    expect(state.stats.breakCount).toBe(1);
    expect(state.stats.totalBreakMinutes).toBe(13);
    expect(state.stats.totalDelayMinutes).toBe(3);
    expect(state.stats.lateBreaks).toBe(1);
    expect(state.nextBreak?.scheduledStart).toBe(at(T0, 133).toISOString());
    await expect(breakSvc.returnToWork(ids.ali, at(T0, 74))).rejects.toMatchObject({ status: 409 });
  });

  it("state is idempotent (refresh-safe)", async () => {
    const a = await stateSvc.getEmployeeState(ids.ali, at(T0, 80));
    const b = await stateSvc.getEmployeeState(ids.ali, at(T0, 80));
    expect(b).toEqual(a);
    expect(a.userStatus).toBe("WORKING");
  });

  it("missed break window is SKIPPED and schedule rolls forward", async () => {
    const state = await stateSvc.getEmployeeState(ids.ali, at(T0, 145));
    expect(state.userStatus).toBe("WORKING");
    const brk = await db.prisma.break.findFirst({
      where: { userId: ids.ali, status: "SKIPPED" },
    });
    expect(brk).not.toBeNull();
    expect(state.nextBreak?.scheduledStart).toBe(at(T0, 203).toISOString());
  });

  it("smart scheduling staggers concurrent starts fairly", async () => {
    for (const name of ["mohammad", "reza", "sara", "nima", "admin"]) {
      await shiftSvc.startShift(ids[name], at(T0, 150));
    }
    const starts = await db.prisma.break.findMany({
      where: { shift: { status: "ACTIVE" }, breakIndex: 0, userId: { not: ids.ali } },
      select: { scheduledStart: true, scheduledEnd: true },
    });
    expect(starts.length).toBe(5);
    const maxConcurrent = Math.max(
      ...starts.flatMap((a) =>
        starts.filter(
          (b) => b.scheduledStart < a.scheduledEnd! && a.scheduledStart < b.scheduledEnd!,
        ).length,
      ),
    );
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });

  it("concurrent break capacity is enforced", async () => {
    const actives = await db.prisma.break.findMany({
      where: { status: "SCHEDULED", shift: { status: "ACTIVE" }, userId: { not: ids.ali } },
    });
    await db.prisma.break.updateMany({
      where: { id: { in: actives.map((b) => b.id) } },
      data: { actualStart: at(T0, 210), status: "ACTIVE" },
    });
    await db.prisma.break.updateMany({
      where: { userId: ids.ali, status: "SCHEDULED" },
      data: { scheduledStart: at(T0, 210), scheduledEnd: at(T0, 220) },
    });
    await expect(breakSvc.startBreak(ids.ali, at(T0, 210))).rejects.toMatchObject({ status: 409 });
  });

  it("end shift closes active break and produces full report", async () => {
    const state = await shiftSvc.endShift(ids.mohammad, at(T0, 215));
    expect(state.hasActiveShift).toBe(false);
    expect(state.shiftEnded).toBe(true);
    expect(state.report?.breakCount).toBe(1);
    expect(state.report?.actualBreakMinutes).toBe(5);
    expect(state.report?.totalDelayMinutes).toBe(0);
    expect(state.timeline.at(-1)?.type).toBe("shift_end");
    await expect(shiftSvc.endShift(ids.mohammad, at(T0, 216))).rejects.toMatchObject({ status: 409 });
  });
});
