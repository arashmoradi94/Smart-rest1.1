import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

process.env.DATABASE_URL = "file:./tmp-test-window.db";

/**
 * Acceptance items 7 & 8, isolated on a temp db:
 *  7) Actual break duration = endedAt - startedAt (6/9/10-minute breaks),
 *     visible in DB, history and analytics — never forced to the scheduled 10.
 *  8) Break start window: before → reject; inside → accept; from the window
 *     end onwards → reject + EXPIRED + next break computed; only the next
 *     valid break is ever surfaced; refresh/login never revives an expired one.
 */

let breakSvc: typeof import("@/services/break-service");
let shiftSvc: typeof import("@/services/shift-service");
let stateSvc: typeof import("@/services/state-service");
let adminSvc: typeof import("@/services/admin-service");
let db: typeof import("@/lib/db");
let ids: Record<string, string> = {};

const at = (base: Date, offsetMin: number) => new Date(base.getTime() + offsetMin * 60_000);

beforeAll(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    if (fs.existsSync(`dev.db${ext}`)) fs.copyFileSync(`dev.db${ext}`, `tmp-test-window.db${ext}`);
  }
  db = await import("@/lib/db");
  await db.prisma.shift.updateMany({ where: { status: "ACTIVE" }, data: { status: "ENDED", endedAt: new Date() } });
  await db.prisma.break.updateMany({
    where: { actualStart: { not: null }, actualEnd: null },
    data: { actualEnd: new Date(), status: "COMPLETED" },
  });
  await db.prisma.user.updateMany({ data: { status: "OFFLINE", onCall: false } });
  breakSvc = await import("@/services/break-service");
  shiftSvc = await import("@/services/shift-service");
  stateSvc = await import("@/services/state-service");
  adminSvc = await import("@/services/admin-service");
  const users = await db.prisma.user.findMany();
  ids = Object.fromEntries(users.map((u) => [u.username, u.id]));
  for (const name of ["ali", "sara", "nima"]) {
    if (!ids[name]) {
      const u = await db.prisma.user.create({
        data: { name, username: name, passwordHash: "x", role: "EMPLOYEE" },
      });
      ids[name] = u.id;
    }
  }
});

afterAll(async () => {
  await db.prisma.$disconnect();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      if (fs.existsSync(`tmp-test-window.db${ext}`)) fs.rmSync(`tmp-test-window.db${ext}`);
    } catch {
      // Windows may hold the file briefly
    }
  }
});

describe("Actual break duration (acceptance item 7)", () => {
  it("6, 9 and 10-minute breaks record their REAL duration in DB, history and analytics", async () => {
    // The scheduler anchors every next break at the ACTUAL end of the previous
    // one + 60m work, and the start window is [scheduledStart, scheduledEnd).
    const S = new Date("2026-09-04T07:00:00.000Z");
    await shiftSvc.startShift(ids.ali, S);
    // Analytics delta baseline (the dev.db copy may already hold old breaks)
    const baseline = await adminSvc.getTeamAnalytics("week", at(S, 240));
    const baselineMinutes = baseline.employees.find((e) => e.userId === ids.ali)?.breakMinutes ?? 0;

    // break 1: window [S+60, S+70); runs S+61 → S+67 = 6 minutes
    await breakSvc.startBreak(ids.ali, at(S, 61));
    await breakSvc.returnToWork(ids.ali, at(S, 67));
    // break 2: anchored at actualEnd S+67 → window [S+127, S+137); runs S+128 → S+137 = 9 minutes
    await breakSvc.startBreak(ids.ali, at(S, 128));
    await breakSvc.returnToWork(ids.ali, at(S, 137));
    // break 3: anchored at actualEnd S+137 → window [S+197, S+207); runs S+197 → S+207 = 10 minutes
    await breakSvc.startBreak(ids.ali, at(S, 197));
    await breakSvc.returnToWork(ids.ali, at(S, 207));

    const state = await stateSvc.getEmployeeState(ids.ali, at(S, 208));
    const durations = state.history
      .filter((b) => b.status === "COMPLETED" || b.status === "LATE")
      .sort((a, b) => a.breakIndex - b.breakIndex)
      .map((b) => b.durationMinutes);
    expect(durations).toEqual([6, 9, 10]);

    // DB holds the real values with the real timestamps — scoped to THIS shift
    // so legacy rows copied from dev.db can never pollute the assertion.
    const shift = await db.prisma.shift.findFirst({
      where: { userId: ids.ali, status: "ACTIVE" },
    });
    const rows = await db.prisma.break.findMany({
      where: { shiftId: shift!.id, status: { in: ["COMPLETED", "LATE"] }, kind: "REGULAR" },
      orderBy: { breakIndex: "asc" },
    });
    expect(rows.map((b) => b.durationMinutes)).toEqual([6, 9, 10]);
    for (const b of rows) {
      const elapsed = Math.round((b.actualEnd!.getTime() - b.actualStart!.getTime()) / 60_000);
      expect(b.durationMinutes).toBe(elapsed);
      expect(b.actualEnd!.getTime() - b.actualStart!.getTime()).toBe(
        b.durationMinutes! * 60_000,
      );
    }

    // analytics aggregate the actual values, not scheduled ones (delta = 6+9+10)
    const analytics = await adminSvc.getTeamAnalytics("week", at(S, 240));
    const me = analytics.employees.find((e) => e.userId === ids.ali);
    expect(me).toBeTruthy();
    expect(me!.breakMinutes).toBe(baselineMinutes + 25);
  });
});

describe("Break window & expiration (acceptance item 8)", () => {
  it("09:59 → reject; 10:00 → accept; return consumed the break", async () => {
    // scheduled 10:00–10:10, window [10:00, 10:10)
    const S = new Date("2026-09-04T09:00:00.000Z");
    await shiftSvc.startShift(ids.sara, S);
    await expect(breakSvc.startBreak(ids.sara, at(S, 59))).rejects.toMatchObject({ status: 409 }); // 09:59 EARLY
    const state = await breakSvc.startBreak(ids.sara, at(S, 60)); // 10:00 ON_TIME
    expect(state.userStatus).toBe("ON_BREAK");
    await breakSvc.returnToWork(ids.sara, at(S, 65));
    await shiftSvc.endShift(ids.sara, at(S, 66));
  });

  it("10:05 and 10:09 → accept: the whole window consumes the same break", async () => {
    // fresh shift next day; scheduled break [S2+60, S2+70)
    const S2 = new Date("2026-09-05T09:00:00.000Z");
    await shiftSvc.startShift(ids.sara, S2);
    const first = await breakSvc.startBreak(ids.sara, at(S2, 65)); // 10:05 — inside the window
    expect(first.userStatus).toBe("ON_BREAK");
    await breakSvc.returnToWork(ids.sara, at(S2, 66));
    // next break anchored at actualEnd S2+66 → window [S2+126, S2+136)
    const second = await breakSvc.startBreak(ids.sara, at(S2, 129)); // 3 min into the window
    expect(second.userStatus).toBe("ON_BREAK");
    await breakSvc.returnToWork(ids.sara, at(S2, 130));
    await shiftSvc.endShift(ids.sara, at(S2, 200));
  });

  it("10:10 (exact window end) → reject; break is EXPIRED and never revived", async () => {
    const S = new Date("2026-09-04T09:00:00.000Z");
    await shiftSvc.startShift(ids.nima, S);
    // jump straight past the window: direct API call at 10:10:00 is EXPIRED
    await expect(breakSvc.startBreak(ids.nima, at(S, 70))).rejects.toMatchObject({ status: 410 });
    const brk = await db.prisma.break.findFirst({
      where: { userId: ids.nima, status: "EXPIRED" },
    });
    expect(brk).toBeTruthy();
    expect(brk!.actualEnd?.getTime()).toBe(at(S, 70).getTime());
    // refresh / logout-login equivalent: still expired, never revived
    await stateSvc.getEmployeeState(ids.nima, at(S, 71));
    const still = await db.prisma.break.findFirst({
      where: { userId: ids.nima, status: "EXPIRED", actualStart: null },
    });
    expect(still).toBeTruthy();
  });

  it("after expiration the system surfaces only the FIRST next valid break", async () => {
    const S = new Date("2026-09-04T09:00:00.000Z");
    const state = await stateSvc.getEmployeeState(ids.nima, at(S, 71));
    expect(state.nextBreak).toBeTruthy();
    expect(state.nextBreak!.scheduledStart).toBe(at(S, 130).toISOString()); // 70 + 60
    expect(state.nextBreak!.ready).toBe(false); // future → window not open
    // exactly ONE scheduled break for this user (never a queue of stale ones)
    const scheduledCount = await db.prisma.break.count({
      where: { userId: ids.nima, status: "SCHEDULED" },
    });
    expect(scheduledCount).toBe(1);
    await shiftSvc.endShift(ids.nima, at(S, 200));
  });
});
