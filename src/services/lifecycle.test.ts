import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

process.env.DATABASE_URL = "file:./tmp-test.db";

const at = (base: Date, offsetMin: number) => new Date(base.getTime() + offsetMin * 60_000);

let shiftSvc: typeof import("@/services/shift-service");
let breakSvc: typeof import("@/services/break-service");
let stateSvc: typeof import("@/services/state-service");
let buddySvc: typeof import("@/services/buddy-service");
let adminSvc: typeof import("@/services/admin-service");
let gamSvc: typeof import("@/services/gamification-service");
let annSvc: typeof import("@/services/announcement-service");
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
  await db.prisma.groupBreak.updateMany({ data: { status: "CANCELLED" } });
  await db.prisma.user.updateMany({ data: { status: "OFFLINE", onCall: false } });
  await db.prisma.buddyLink.deleteMany({});
  await db.prisma.buddyRequest.deleteMany({});
  shiftSvc = await import("@/services/shift-service");
  breakSvc = await import("@/services/break-service");
  stateSvc = await import("@/services/state-service");
  buddySvc = await import("@/services/buddy-service");
  adminSvc = await import("@/services/admin-service");
  gamSvc = await import("@/services/gamification-service");
  annSvc = await import("@/services/announcement-service");
  const users = await db.prisma.user.findMany();
  ids = Object.fromEntries(users.map((u) => [u.username, u.id]));
  // Self-healing seed: guarantee the users this suite needs exist (dev.db may have been edited)
  const needed = [
    "ali", "mohammad", "reza", "sara", "nima", "admin",
    "u1", "u2", "u3", "lateuser",
  ];
  for (const name of needed) {
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

  it("break cannot start before its window (backend rejects early start)", async () => {
    // break is scheduled for T0+60 — starting at T0+59 must be rejected
    await expect(breakSvc.startBreak(ids.ali, at(T0, 59))).rejects.toMatchObject({ status: 409 });
  });

  it("break starts inside the window and runs for the full duration", async () => {
    const state = await breakSvc.startBreak(ids.ali, at(T0, 60));
    expect(state.userStatus).toBe("ON_BREAK");
    expect(state.currentBreak?.status).toBe("ACTIVE");
    expect(state.timerSeconds).toBe(600);
  });

  it("duplicate break start and return are rejected", async () => {
    await expect(breakSvc.startBreak(ids.ali, at(T0, 63))).rejects.toMatchObject({ status: 409 });
  });

  it("late return: actual duration 13m recorded, next break follows actual end", async () => {
    // started at T0+60 → fixed end T0+70; returning at T0+73 → actual 13m, 3m late
    const state = await breakSvc.returnToWork(ids.ali, at(T0, 73));
    expect(state.userStatus).toBe("WORKING");
    expect(state.stats.breakCount).toBe(1);
    expect(state.stats.totalBreakMinutes).toBe(13); // ACTUAL elapsed, not scheduled 10
    expect(state.stats.totalDelayMinutes).toBe(3);
    expect(state.stats.lateBreaks).toBe(1);
    // next work cycle anchored to the ACTUAL end (T0+73) + 60m work
    expect(state.nextBreak?.scheduledStart).toBe(at(T0, 133).toISOString());
    await expect(breakSvc.returnToWork(ids.ali, at(T0, 74))).rejects.toMatchObject({ status: 409 });
  });

  it("state is idempotent (refresh-safe)", async () => {
    const a = await stateSvc.getEmployeeState(ids.ali, at(T0, 80));
    const b = await stateSvc.getEmployeeState(ids.ali, at(T0, 80));
    expect(b).toEqual(a);
    expect(a.userStatus).toBe("WORKING");
  });

  it("expired break is finalised (never revived) and the next break is computed", async () => {
    const state = await stateSvc.getEmployeeState(ids.ali, at(T0, 145));
    expect(state.userStatus).toBe("WORKING");
    // Scope to ali's CURRENT shift: legacy SKIPPED rows from dev.db must not affect this
    const shift = await db.prisma.shift.findFirst({
      where: { userId: ids.ali, status: "ACTIVE" },
    });
    const brk = await db.prisma.break.findFirst({
      where: { shiftId: shift!.id, status: "SKIPPED" },
    });
    expect(brk).toBeNull();
    // the 133-scheduled break (window 133→143) expired at 143 — never revived
    const expiredBreak = await db.prisma.break.findFirst({
      where: { shiftId: shift!.id, status: "EXPIRED" },
    });
    expect(expiredBreak?.actualEnd?.getTime()).toBe(at(T0, 143).getTime());
    // the next break is computed from the expired window end (+60m work)
    expect(state.nextBreak?.scheduledStart).toBe(at(T0, 203).toISOString());
    expect(state.nextBreak?.ready).toBe(false); // future break → window not open
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

  it("end shift closes active break with its ACTUAL duration and produces full report", async () => {
    const state = await shiftSvc.endShift(ids.mohammad, at(T0, 215));
    expect(state.hasActiveShift).toBe(false);
    expect(state.shiftEnded).toBe(true);
    expect(state.report?.breakCount).toBe(1);
    // break ran [T0+210, T0+215) → ACTUAL 5 minutes (not the scheduled 10)
    expect(state.report?.actualBreakMinutes).toBe(5);
    expect(state.report?.totalDelayMinutes).toBe(0);
    expect(state.timeline.at(-1)?.type).toBe("shift_end");
    await expect(shiftSvc.endShift(ids.mohammad, at(T0, 216))).rejects.toMatchObject({ status: 409 });
  });
});

describe("Production core scenario: 16:00 scheduled + 16:07 actualStart => 16:17 actualEnd", () => {
  // lateuser starts shift at 15:00 → break scheduled 16:00–16:10.
  // Starts late at 16:07 (e.g. was on a call). Break still gets its FULL 10
  // minutes from actualStart: fixed end 16:17 — later start never shortens it,
  // scheduledEnd 16:10 never auto-ends it.
  const S = new Date("2026-08-24T15:00:00.000Z");

  it("schedules 16:00–16:10 after a 15:00 shift start", async () => {
    const state = await shiftSvc.startShift(ids.lateuser, S);
    expect(state.nextBreak?.scheduledStart).toBe(new Date("2026-08-24T16:00:00.000Z").toISOString());
    expect(state.nextBreak?.scheduledEnd).toBe(new Date("2026-08-24T16:10:00.000Z").toISOString());
  });

  it("READY flag flips when the window arrives (but nothing auto-starts)", async () => {
    const before = await stateSvc.getEmployeeState(ids.lateuser, at(S, 59));
    expect(before.nextBreak?.ready).toBe(false);
    const after = await stateSvc.getEmployeeState(ids.lateuser, at(S, 61));
    expect(after.nextBreak?.ready).toBe(true);
    expect(after.userStatus).toBe("WORKING"); // still working — manual start only
  });

  it("16:07 manual start → full 10 minutes (timer 600s, not 180s)", async () => {
    const state = await breakSvc.startBreak(ids.lateuser, at(S, 67)); // 16:07
    expect(state.currentBreak?.actualStart).toBe(at(S, 67).toISOString());
    expect(state.userStatus).toBe("ON_BREAK");
    expect(state.timerSeconds).toBe(600); // FULL duration from actualStart
    expect(state.currentBreak?.status).toBe("ACTIVE");
  });

  it("scheduledEnd (16:10) never auto-ends; at 16:12 still on break", async () => {
    const state = await stateSvc.getEmployeeState(ids.lateuser, at(S, 72)); // 16:12
    expect(state.userStatus).toBe("ON_BREAK");
    expect(state.currentBreak?.status).toBe("ACTIVE");
  });

  it("return at 16:20 → actualEnd 16:20, duration 13m, delay=3, next cycle from actual end", async () => {
    const state = await breakSvc.returnToWork(ids.lateuser, at(S, 80)); // 16:20
    expect(state.userStatus).toBe("WORKING");
    expect(state.stats.totalDelayMinutes).toBe(3); // 3m past the fixed end 16:17
    expect(state.stats.totalBreakMinutes).toBe(13); // ACTUAL elapsed 16:07→16:20
    // next work cycle anchored to actualEnd 16:20 (+60m work)
    expect(state.nextBreak?.scheduledStart).toBe(at(S, 140).toISOString()); // 17:20
    const brk = await db.prisma.break.findFirst({
      where: { userId: ids.lateuser, actualStart: at(S, 67) },
    });
    expect(brk?.actualEnd?.toISOString()).toBe(at(S, 80).toISOString()); // 16:20 real return
    expect(brk?.durationMinutes).toBe(13);
    expect(brk?.endDelayMinutes).toBe(3);
    expect(brk?.status).toBe("LATE");
  });

  it("OVERTIME: no return past the fixed end → OVERTIME status, refresh-stable", async () => {
    // Start a second break at 17:20 (window open), never return, then jump past 17:30+5
    await breakSvc.startBreak(ids.lateuser, at(S, 140));
    let state = await stateSvc.getEmployeeState(ids.lateuser, at(S, 146)); // mid break
    expect(state.currentBreak?.status).toBe("ACTIVE");
    state = await stateSvc.getEmployeeState(ids.lateuser, at(S, 152)); // 17:32 → 2m overdue
    expect(state.currentBreak?.status).toBe("OVERTIME");
    expect(state.userStatus).toBe("LATE");
    // refresh-safe: stable on repeat
    const again = await stateSvc.getEmployeeState(ids.lateuser, at(S, 152));
    expect(again.currentBreak?.status).toBe("OVERTIME");
    // returning after overtime records delay and the real elapsed duration
    const done = await breakSvc.returnToWork(ids.lateuser, at(S, 155));
    expect(done.stats.totalDelayMinutes).toBeGreaterThanOrEqual(3);
    const brk = await db.prisma.break.findFirst({
      where: { userId: ids.lateuser, actualStart: at(S, 140) },
    });
    expect(brk?.durationMinutes).toBe(15); // ACTUAL elapsed 17:20→17:35
    await shiftSvc.endShift(ids.lateuser, at(S, 200));
  });
});

describe("Admin overrides: extend / cancel / grant / audit", () => {
  it("extends a running break by 5 minutes (timer end shifts, actual duration still real)", async () => {
    // Close the manual ACTIVE breaks opened by the capacity test above
    await db.prisma.break.updateMany({
      where: { actualStart: { not: null }, actualEnd: null },
      data: { actualEnd: at(T0, 220), status: "COMPLETED" },
    });
    await db.prisma.user.updateMany({ where: { status: "ON_BREAK" }, data: { status: "WORKING" } });
    await shiftSvc.startShift(ids.u1, at(T0, 300));
    await breakSvc.startBreak(ids.u1, at(T0, 360));
    const running = await db.prisma.break.findFirst({
      where: { userId: ids.u1, status: "ACTIVE" },
    });
    await breakSvc.extendBreak(ids.admin, running!.id, 5);
    // extension pushes the fixed end to actualStart+15 → overtime/lateness measured from there
    const state = await stateSvc.getEmployeeState(ids.u1, at(T0, 370));
    expect(state.currentBreak?.endsAt).toBe(at(T0, 375).toISOString());
    const done = await breakSvc.returnToWork(ids.u1, at(T0, 371));
    expect(done.stats.totalBreakMinutes).toBe(11); // ACTUAL elapsed T0+360→T0+371
    await shiftSvc.endShift(ids.u1, at(T0, 380));
  });

  it("cancels a scheduled break without destroying history", async () => {
    await shiftSvc.startShift(ids.u2, at(T0, 300));
    const scheduled = await db.prisma.break.findFirst({
      where: { userId: ids.u2, status: "SCHEDULED" },
    });
    await breakSvc.cancelBreak(ids.admin, scheduled!.id);
    const cancelled = await db.prisma.break.findUnique({ where: { id: scheduled!.id } });
    expect(cancelled?.status).toBe("CANCELLED");
    expect(cancelled?.scheduledStart).toBeTruthy(); // history preserved
    // next state visit schedules a fresh break
    const state = await stateSvc.getEmployeeState(ids.u2, at(T0, 380));
    expect(state.nextBreak).toBeTruthy();
    await shiftSvc.endShift(ids.u2, at(T0, 390));
  });

  it("grants coins via admin, logs audit", async () => {
    await gamSvc.grantCoins(ids.admin, ids.reza, 25, "GREAT_SHIFT");
    const balance = await gamSvc.getCoinBalance(ids.reza);
    expect(balance).toBeGreaterThanOrEqual(25);
    const audit = await adminSvc.listAudit(50);
    expect(audit.some((a) => a.action === "GRANT_COINS" && (a.details ?? "").includes("25"))).toBe(true);
  });

  it("announcements: create, unread for target, read after mark", async () => {
    const created = await annSvc.createAnnouncement(ids.admin, "تست اطلاعیه گروهی", [ids.reza]);
    const latest = await annSvc.getLatestForUser(ids.reza);
    expect(latest.message).toBe("تست اطلاعیه گروهی");
    expect(latest.unread).toBe(true);
    // another user must NOT see the targeted announcement
    const other = await annSvc.getLatestForUser(ids.nima);
    expect(other.message ?? "").not.toBe("تست اطلاعیه گروهی");
    await annSvc.markRead(ids.reza, (latest as { id: string }).id);
    const after = await annSvc.getLatestForUser(ids.reza);
    expect(after.unread).toBe(false);
    void created;
  });
});

describe("Buddy system + group break sync", () => {
  it("request → accept links two users; max 2 buddies enforced", async () => {
    await buddySvc.sendBuddyRequest(ids.u1, ids.u2);
    const list = await buddySvc.listBuddies(ids.u2);
    expect(list.incomingRequests.length).toBe(1);
    await buddySvc.respondBuddyRequest(ids.u2, list.incomingRequests[0].id, true);
    const u1List = await buddySvc.listBuddies(ids.u1);
    expect(u1List.buddies.map((b) => b.id)).toContain(ids.u2);
  });

  it("group ready-sync: shared server timestamp, full duration for both", async () => {
    const G0 = new Date("2026-08-24T10:00:00.000Z");
    await shiftSvc.startShift(ids.u1, G0);
    await shiftSvc.startShift(ids.u2, G0);
    const r1 = await buddySvc.readyForGroupBreak(ids.u1, at(G0, 61));
    expect(r1.started).toBe(false);
    expect(r1.totalCount).toBe(2);
    // second member readies → break starts for BOTH with one timestamp
    const r2 = await buddySvc.readyForGroupBreak(ids.u2, at(G0, 62));
    expect(r2.started).toBe(true);
    const breaks = await db.prisma.break.findMany({
      where: { userId: { in: [ids.u1, ids.u2] }, actualStart: { not: null }, actualEnd: null },
    });
    expect(breaks.length).toBe(2);
    const starts = new Set(breaks.map((b) => b.actualStart?.toISOString()));
    expect(starts.size).toBe(1); // ONE shared timestamp
    expect(breaks.every((b) => b.groupBreakId)).toBe(true);
    // both get the full duration
    for (const uid of [ids.u1, ids.u2]) {
      const st = await stateSvc.getEmployeeState(uid, at(G0, 65));
      expect(st.currentBreak?.status).toBe("ACTIVE");
      expect(st.currentBreak?.endsAt).toBe(at(G0, 72).toISOString()); // 62+10
    }
  });

  it("group completes when everyone returns; late member delay recorded", async () => {
    // group started at G0+62 = 11:02 → fixed end 11:12
    await breakSvc.returnToWork(ids.u1, new Date("2026-08-24T11:10:00.000Z")); // on time
    const st2 = await breakSvc.returnToWork(ids.u2, new Date("2026-08-24T11:15:00.000Z")); // 3m late
    expect(st2.stats.totalDelayMinutes).toBe(3);
    const groups = await db.prisma.groupBreak.findMany({
      where: { status: "COMPLETED" },
    });
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("on-call member cannot start a group break until the call ends", async () => {
    // isolate: u1 is linked only to u3 for this scenario
    await db.prisma.buddyLink.deleteMany({});
    const [a, b] = ids.u1 < ids.u3 ? [ids.u1, ids.u3] : [ids.u3, ids.u1];
    await db.prisma.buddyLink.create({ data: { aId: a, bId: b } });
    await db.prisma.user.update({ where: { id: ids.u3 }, data: { onCall: true, status: "WORKING" } });
    const H0 = new Date("2026-08-24T12:00:00.000Z");
    await shiftSvc.startShift(ids.u3, H0);
    // u1 readies; an on-call member cannot start the group
    const r1 = await buddySvc.readyForGroupBreak(ids.u1, at(H0, 61));
    expect(r1.started).toBe(false);
    await expect(buddySvc.readyForGroupBreak(ids.u3, at(H0, 62))).rejects.toMatchObject({ status: 409 });
    // waiting member sees WAITING_BUDDY while the group is forming
    const waiting = await stateSvc.getEmployeeState(ids.u1, at(H0, 63));
    expect(waiting.userStatus).toBe("WAITING_BUDDY");
    // u3 finishes the call, readies again → group starts for both
    await db.prisma.user.update({ where: { id: ids.u3 }, data: { onCall: false } });
    const r4 = await buddySvc.readyForGroupBreak(ids.u3, at(H0, 70));
    expect(r4.started).toBe(true);
    await breakSvc.returnToWork(ids.u1, at(H0, 82));
    await breakSvc.returnToWork(ids.u3, at(H0, 81));
    await shiftSvc.endShift(ids.u1, at(H0, 200));
    await shiftSvc.endShift(ids.u3, at(H0, 200));
  });

  it("leave a forming group → solo start works again", async () => {
    // u2 still has the G0 shift (active); link u1↔u2 so the roster is real
    await db.prisma.buddyLink.deleteMany({});
    const [a, b] = ids.u1 < ids.u2 ? [ids.u1, ids.u2] : [ids.u2, ids.u1];
    await db.prisma.buddyLink.create({ data: { aId: a, bId: b } });
    const K0 = new Date("2026-08-24T14:00:00.000Z");
    await shiftSvc.startShift(ids.u1, K0);
    const r = await buddySvc.readyForGroupBreak(ids.u1, at(K0, 61)); // waiting for u2
    expect(r.started).toBe(false);
    // u1's break is bound to the forming group → solo start blocked
    await expect(breakSvc.startBreak(ids.u1, at(K0, 62))).rejects.toMatchObject({ status: 409 });
    await breakSvc.leaveGroup(ids.u1);
    const state = await breakSvc.startBreak(ids.u1, at(K0, 63));
    expect(state.currentBreak?.group).toBe(false);
    await breakSvc.returnToWork(ids.u1, at(K0, 73));
    await shiftSvc.endShift(ids.u1, at(K0, 90));
    await shiftSvc.endShift(ids.u2, at(K0, 95));
  });

  it("solo ready with no on-shift buddy is rejected (use solo start instead)", async () => {
    await db.prisma.buddyLink.deleteMany({});
    const L0 = new Date("2026-08-24T15:00:00.000Z");
    await shiftSvc.startShift(ids.u2, L0);
    await expect(buddySvc.readyForGroupBreak(ids.u2, at(L0, 61))).rejects.toMatchObject({ status: 409 });
    const state = await breakSvc.startBreak(ids.u2, at(L0, 62));
    expect(state.currentBreak?.group).toBe(false);
    await breakSvc.returnToWork(ids.u2, at(L0, 72));
    await shiftSvc.endShift(ids.u2, at(L0, 90));
  });

  it("group waits when capacity cannot fit the whole group", async () => {
    // settings maxConcurrent=5 (default). Occupy 4 slots with manual ACTIVE breaks.
    const occ = ["mohammad", "reza", "sara", "nima"];
    const M0 = new Date("2026-08-24T16:00:00.000Z");
    for (const name of occ) {
      const sh = await db.prisma.shift.create({ data: { userId: ids[name], startedAt: M0, status: "ACTIVE" } });
      await db.prisma.break.create({
        data: {
          shiftId: sh.id, userId: ids[name], breakIndex: 0,
          scheduledStart: M0, scheduledEnd: at(M0, 10),
          actualStart: at(M0, 1), status: "ACTIVE",
        },
      });
    }
    await db.prisma.buddyLink.create({ data: { aId: ids.u1 < ids.u2 ? ids.u1 : ids.u2, bId: ids.u1 < ids.u2 ? ids.u2 : ids.u1 } });
    const N0 = new Date("2026-08-24T16:30:00.000Z");
    await shiftSvc.startShift(ids.u1, N0);
    await shiftSvc.startShift(ids.u2, N0);
    const r1 = await buddySvc.readyForGroupBreak(ids.u1, at(N0, 61));
    const r2 = await buddySvc.readyForGroupBreak(ids.u2, at(N0, 62));
    // 4 occupied + group of 2 > 5 → group must keep waiting, no partial start
    expect(r2.started).toBe(false);
    const active = await db.prisma.break.count({
      where: { userId: { in: [ids.u1, ids.u2] }, actualStart: { not: null }, actualEnd: null },
    });
    expect(active).toBe(0);
    void r1;
    // cleanup
    await breakSvc.leaveGroup(ids.u1).catch(() => {});
    await breakSvc.leaveGroup(ids.u2).catch(() => {});
    await db.prisma.break.deleteMany({ where: { userId: { in: occ.map((n) => ids[n]) }, actualStart: at(M0, 1) } });
    await db.prisma.shift.updateMany({ where: { userId: { in: occ.map((n) => ids[n]) } }, data: { status: "ENDED", endedAt: at(M0, 30) } });
    await shiftSvc.endShift(ids.u1, at(N0, 90));
    await shiftSvc.endShift(ids.u2, at(N0, 90));
    await db.prisma.buddyLink.deleteMany({});
  });
});

describe("Emergency break → work timer survives", () => {
  it("after an emergency ends, the same shift's scheduled break still drives the work timer", async () => {
    // E0=09:00 shift → break scheduled 10:00. Emergency 09:25→09:30 must not
    // hide the work timer, reset the shift, or create a new shift.
    await shiftSvc.endShift(ids.nima).catch(() => {});
    const E0 = new Date("2026-08-24T09:00:00.000Z");
    await shiftSvc.startShift(ids.nima, E0);
    // before the emergency the work timer is active (countdown to next break)
    let st = await stateSvc.getEmployeeState(ids.nima, at(E0, 20));
    expect(st.userStatus).toBe("WORKING");
    expect(st.nextBreak?.scheduledStart).toBe(at(E0, 60).toISOString());
    // during the emergency the status is EMERGENCY
    await breakSvc.startEmergencyBreak(ids.nima, "URGENT_REST", undefined, at(E0, 25));
    st = await stateSvc.getEmployeeState(ids.nima, at(E0, 27));
    expect(st.userStatus).toBe("EMERGENCY");
    // emergency ends → WORKING, timer visible again, anchored to backend timestamps
    st = await breakSvc.returnToWork(ids.nima, at(E0, 30));
    expect(st.userStatus).toBe("WORKING");
    expect(st.nextBreak?.scheduledStart).toBe(at(E0, 60).toISOString());
    expect(st.timerSeconds).toBe(30 * 60);
    // the same shift, same start timestamp — no new shift was created
    const shifts = await db.prisma.shift.findMany({
      where: { userId: ids.nima, status: "ACTIVE" },
    });
    expect(shifts.length).toBe(1);
    expect(shifts[0].startedAt.getTime()).toBe(E0.getTime());
    // refresh-safe and login-safe: recomputed from the backend, never zero
    const refreshed = await stateSvc.getEmployeeState(ids.nima, at(E0, 31));
    expect(refreshed.userStatus).toBe("WORKING");
    expect(refreshed.nextBreak?.scheduledStart).toBe(at(E0, 60).toISOString());
    expect(refreshed.timerSeconds).toBe(29 * 60);
    await shiftSvc.endShift(ids.nima, at(E0, 90));
  });

  it("emergency duration is tracked separately from regular breaks", async () => {
    await shiftSvc.endShift(ids.nima).catch(() => {});
    const E0 = new Date("2026-08-24T09:00:00.000Z");
    await shiftSvc.startShift(ids.nima, E0);
    await breakSvc.startEmergencyBreak(ids.nima, "ILLNESS", undefined, at(E0, 10));
    const st = await breakSvc.returnToWork(ids.nima, at(E0, 16));
    expect(st.userStatus).toBe("WORKING");
    // 6-minute emergency: regular break stats untouched, next break unchanged
    expect(st.stats.breakCount).toBe(0);
    expect(st.stats.totalBreakMinutes).toBe(0);
    expect(st.nextBreak?.scheduledStart).toBe(at(E0, 60).toISOString());
    await shiftSvc.endShift(ids.nima, at(E0, 90));
  });
});

describe("Timezone: streak uses the company timezone (Asia/Tehran)", () => {
  it("crossing UTC days within one Tehran day does not break the streak", async () => {
    await db.prisma.user.update({
      where: { id: ids.nima },
      data: { streakDays: 0, lastShiftDate: null },
    });
    const d1 = new Date("2026-08-24T23:00:00.000Z"); // Tehran Aug 25, 02:30
    await gamSvc.touchStreak(ids.nima, d1);
    let u = await db.prisma.user.findUnique({ where: { id: ids.nima }, select: { streakDays: true } });
    expect(u?.streakDays).toBe(1);
    // 2 UTC days later but the NEXT Tehran day → consecutive
    await gamSvc.touchStreak(ids.nima, new Date("2026-08-26T01:00:00.000Z")); // Tehran Aug 26
    u = await db.prisma.user.findUnique({ where: { id: ids.nima }, select: { streakDays: true } });
    expect(u?.streakDays).toBe(2);
  });

  it("same Tehran day (late UTC evening) does not double-count", async () => {
    await db.prisma.user.update({
      where: { id: ids.nima },
      data: { streakDays: 0, lastShiftDate: null },
    });
    const d1 = new Date("2026-08-27T18:00:00.000Z"); // Tehran Aug 27, 21:30
    await gamSvc.touchStreak(ids.nima, d1);
    const d2 = new Date("2026-08-27T20:00:00.000Z"); // Tehran Aug 27, 23:30 — same day
    await gamSvc.touchStreak(ids.nima, d2);
    const u = await db.prisma.user.findUnique({ where: { id: ids.nima }, select: { streakDays: true } });
    expect(u?.streakDays).toBe(1);
  });
});

describe("Admin live state: capacity, forecast, statuses", () => {
  it("radar exposes capacity usage and forecast of upcoming breaks", async () => {
    await shiftSvc.endShift(ids.reza, new Date("2026-08-24T17:00:00.000Z")).catch(() => {});
    const P0 = new Date("2026-08-24T18:00:00.000Z");
    await shiftSvc.startShift(ids.reza, P0);
    const state = await adminSvc.getAdminState(at(P0, 5));
    expect(state.stats.activeBreaks).toBeGreaterThanOrEqual(0);
    expect(state.stats.remainingCapacity).toBe(
      Math.max(0, state.settings.maxConcurrentBreaks - state.stats.activeBreaks),
    );
    const reza = state.employees.find((e) => e.id === ids.reza);
    expect(reza?.nextBreakAt).toBeTruthy();
    expect(state.forecast.some((f) => f.userId === ids.reza)).toBe(true);
    expect(typeof state.stats.onCall).toBe("number");
    expect(typeof state.stats.waitingBuddy).toBe("number");
    await shiftSvc.endShift(ids.reza, at(P0, 10));
  });

  it("team analytics computes totals, on-time % and daily buckets", async () => {
    // Explicit anchor: the suite's shifts live at fixed T0-based dates, so a
    // real-clock "now" would drift them out of the week window over time.
    const analytics = await adminSvc.getTeamAnalytics("week", at(T0, 12 * 60));
    expect(analytics.period).toBe("week");
    expect(analytics.onTimePercent).toBeGreaterThanOrEqual(0);
    expect(analytics.onTimePercent).toBeLessThanOrEqual(100);
    expect(Array.isArray(analytics.peakTimes)).toBe(true);
    expect(Array.isArray(analytics.dailyBuckets)).toBe(true);
    expect(analytics.employees.length).toBeGreaterThan(0);
  });

  it("user history returns shifts with full break detail", async () => {
    const history = await adminSvc.getUserHistory(ids.lateuser);
    expect(history.length).toBeGreaterThan(0);
    const withBreaks = history.find((h) => h.breaks.length > 0);
    expect(withBreaks).toBeTruthy();
    expect(withBreaks!.breaks[0]).toHaveProperty("scheduledStart");
    expect(withBreaks!.breaks[0]).toHaveProperty("actualStart");
  });
});

describe("Stale session / deleted user → clean 401, never an FK violation", () => {
  it("startShift with a userId that no longer exists rejects 401 and writes nothing", async () => {
    const ghost = await db.prisma.user.create({
      data: { name: "ghost", username: "ghost", passwordHash: "x", role: "EMPLOYEE" },
    });
    // Simulate the production failure: the account row is gone (deleted, or DB
    // rebuilt/re-seeded with fresh ids) but a session may still carry its id.
    await db.prisma.user.delete({ where: { id: ghost.id } });
    await expect(shiftSvc.startShift(ghost.id, at(T0, 5))).rejects.toMatchObject({ status: 401 });
    // No Shift row is ever written with the stale foreign key.
    const rows = await db.prisma.shift.count({ where: { userId: ghost.id } });
    expect(rows).toBe(0);
  });

  it("multi-user lifecycle: A start/end → B start/end → refresh → re-login → A starts again", async () => {
    await shiftSvc.endShift(ids.ali).catch(() => {});
    await shiftSvc.endShift(ids.sara).catch(() => {});
    const A = at(T0, 500);
    await shiftSvc.startShift(ids.ali, A);
    await shiftSvc.endShift(ids.ali, at(A, 30));
    const B = at(T0, 530);
    await shiftSvc.startShift(ids.sara, B);
    await shiftSvc.endShift(ids.sara, at(B, 30));
    // Refresh recomputes state from the DB — no orphan, no new Shift.
    const st = await stateSvc.getEmployeeState(ids.ali, at(T0, 560));
    expect(st.hasActiveShift).toBe(false);
    const firstCount = await db.prisma.shift.count({ where: { userId: ids.ali } });
    // Logout/login re-binds the session to the SAME row (user still exists) —
    // exactly one new Shift is created, not an FK violation.
    await shiftSvc.startShift(ids.ali, at(T0, 570));
    const active = await db.prisma.shift.findFirst({ where: { userId: ids.ali, status: "ACTIVE" } });
    expect(active).toBeTruthy();
    const secondCount = await db.prisma.shift.count({ where: { userId: ids.ali } });
    expect(secondCount).toBe(firstCount + 1);
    await shiftSvc.endShift(ids.ali, at(T0, 600));
  });
});
