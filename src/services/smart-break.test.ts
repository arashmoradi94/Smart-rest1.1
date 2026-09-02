import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

process.env.DATABASE_URL = "file:./tmp-test.db";

const at = (base: Date, offsetMin: number) => new Date(base.getTime() + offsetMin * 60_000);

let db: typeof import("@/lib/db");
let smart: typeof import("@/services/smart-break-service");
let buddySvc: typeof import("@/services/buddy-service");
let shiftSvc: typeof import("@/services/shift-service");
let breakSvc: typeof import("@/services/break-service");
let stateSvc: typeof import("@/services/state-service");
let settingsSvc: typeof import("@/services/settings-service");
let ids: Record<string, string> = {};

const T0 = new Date("2026-08-24T08:00:00.000Z");
const BASE_SETTINGS = {
  workDurationMinutes: 60,
  breakDurationMinutes: 10,
  maxConcurrentBreaks: 5,
  maxGroupBreakLoadRatio: 0.3,
};

beforeAll(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    if (fs.existsSync(`dev.db${ext}`)) fs.copyFileSync(`dev.db${ext}`, `tmp-test.db${ext}`);
  }
  db = await import("@/lib/db");
  await db.prisma.shift.updateMany({ where: { status: "ACTIVE" }, data: { status: "ENDED", endedAt: new Date() } });
  await db.prisma.break.updateMany({ where: { actualStart: { not: null }, actualEnd: null }, data: { actualEnd: new Date(), status: "COMPLETED" } });
  await db.prisma.groupBreak.updateMany({ data: { status: "CANCELLED" } });
  await db.prisma.user.updateMany({ data: { status: "OFFLINE", onCall: false } });
  await db.prisma.buddyLink.deleteMany({});
  await db.prisma.buddyRequest.deleteMany({});
  smart = await import("@/services/smart-break-service");
  buddySvc = await import("@/services/buddy-service");
  shiftSvc = await import("@/services/shift-service");
  breakSvc = await import("@/services/break-service");
  stateSvc = await import("@/services/state-service");
  settingsSvc = await import("@/services/settings-service");
  const users = await db.prisma.user.findMany();
  ids = Object.fromEntries(users.map((u) => [u.username, u.id]));
  // Self-healing seed (dev.db may have been edited): guarantee needed users
  for (const name of ["ali", "mohammad", "reza", "u1", "u2", "u3", "admin"]) {
    if (!ids[name]) {
      const u = await db.prisma.user.create({
        data: { name, username: name, passwordHash: "x", role: name === "admin" ? "ADMIN" : "EMPLOYEE" },
      });
      ids[name] = u.id;
    }
  }
});

afterAll(async () => {
  await settingsSvc.updateSettings({ groupBreakEnabled: true, maxGroupBreakLoadRatio: 0.3 });
  await db.prisma.$disconnect();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      if (fs.existsSync(`tmp-test.db${ext}`)) fs.rmSync(`tmp-test.db${ext}`);
    } catch {
      // Windows may hold the file briefly
    }
  }
});

describe("evaluateGroupBreak (pure decision layer)", () => {
  it("APPROVES the user's reference case: 20 online, 2 on break, group of 3", () => {
    const r = smart.evaluateGroupBreak({
      enabled: true,
      groupSize: 3,
      onlineAgents: 20,
      onBreakCount: 2,
      settings: BASE_SETTINGS,
      othersScheduled: [],
      from: new Date(),
    });
    expect(r).toEqual({ decision: "APPROVED" }); // (2+3)/20 = 25% ≤ 30%
  });

  it("DELAYS on load guard: 10 online, 5 on break (capacity raised)", () => {
    const r = smart.evaluateGroupBreak({
      enabled: true,
      groupSize: 2,
      onlineAgents: 10,
      onBreakCount: 5,
      settings: { ...BASE_SETTINGS, maxConcurrentBreaks: 9 },
      othersScheduled: [],
      from: new Date(),
    });
    expect(r.decision).toBe("DELAYED"); // (5+2)/10 = 70% > 30%
    if (r.decision === "DELAYED") expect(r.reason).toBe("load");
  });

  it("DELAYS on capacity and coordinates the slot with the existing queue", () => {
    // 4 running breaks occupy [now, now+10); capacity 5 → a group of 2 can't start
    // now. Suggestion must land on the first minute they all end.
    const now = new Date("2026-08-24T10:00:00.000Z");
    const others = Array.from({ length: 4 }, (_, i) => ({
      userId: `u${i}`,
      scheduledStart: now,
      scheduledEnd: at(now, 10),
    }));
    const r = smart.evaluateGroupBreak({
      enabled: true,
      groupSize: 2,
      onlineAgents: 100, // load guard irrelevant here
      onBreakCount: 4,
      settings: BASE_SETTINGS,
      othersScheduled: others,
      from: now,
      searchMinutes: 15,
    });
    expect(r.decision).toBe("DELAYED");
    if (r.decision === "DELAYED") {
      expect(r.reason).toBe("capacity");
      // First free minute: the 4 others end at +10 → slot at exactly +10
      expect(r.suggestedStart).toBe(at(now, 10).toISOString());
      expect(r.suggestedEnd).toBe(at(now, 20).toISOString());
    }
  });

  it("returns DISABLED when the feature switch is off", () => {
    const r = smart.evaluateGroupBreak({
      enabled: false,
      groupSize: 2,
      onlineAgents: 20,
      onBreakCount: 0,
      settings: BASE_SETTINGS,
      othersScheduled: [],
      from: new Date(),
    });
    expect(r).toEqual({ decision: "DISABLED" });
  });
});

describe("rankBreakMatches (Break Matching)", () => {
  const now = new Date("2026-08-24T10:00:00.000Z");

  it("only matches within the window, excludes on-call, ranks buddies first", () => {
    const r = smart.rankBreakMatches(
      [
        { userId: "a", name: "Ali", isBuddy: false, onCall: false, nextBreak: { scheduledStart: at(now, 6), scheduledEnd: at(now, 16) } },
        { userId: "b", name: "Reza", isBuddy: true, onCall: false, nextBreak: { scheduledStart: at(now, 9), scheduledEnd: at(now, 19) } },
        { userId: "c", name: "Sara", isBuddy: false, onCall: false, nextBreak: { scheduledStart: at(now, 45), scheduledEnd: at(now, 55) } }, // outside window
        { userId: "d", name: "Nima", isBuddy: true, onCall: true, nextBreak: { scheduledStart: at(now, 3), scheduledEnd: at(now, 13) } }, // on call
        { userId: "e", name: "Mohammad", isBuddy: false, onCall: false, nextBreak: { scheduledStart: at(now, 2), scheduledEnd: at(now, 12) } }, // past-ish soonest
      ],
      now,
      10,
    );
    expect(r.map((m) => m.userId)).toEqual(["b", "e", "a"]);
    expect(r[0].minutesUntilBreak).toBe(9);
    expect(r.find((m) => m.userId === "d")).toBeUndefined();
    expect(r.find((m) => m.userId === "c")).toBeUndefined();
  });
});

describe("Smart group flow (integration, temp db)", () => {
  // 6 agents online; 4 of them on a running break [T0+1, T0+11). ali+u1 are
  // buddies trying to break together — the exact "team under pressure" case.
  beforeAll(async () => {
    await settingsSvc.updateSettings({ groupBreakEnabled: true, maxGroupBreakLoadRatio: 1.0 });
    for (const u of [ids.ali, ids.u1, ids.mohammad, ids.reza, ids.u2, ids.u3]) {
      await shiftSvc.startShift(u, T0);
    }
    for (const u of [ids.mohammad, ids.reza, ids.u2, ids.u3]) {
      await breakSvc.startBreak(u, at(T0, 1), { force: true });
    }
    await buddySvc.adminSetBuddy(ids.admin, ids.ali, ids.u1, true);
  });

  it("capacity block suggests the first feasible slot (when running breaks end) without rescheduling anyone", async () => {
    await settingsSvc.updateSettings({ maxConcurrentBreaks: 5, maxGroupBreakLoadRatio: 1.0 });
    const aliBefore = await db.prisma.break.findFirst({ where: { userId: ids.ali, status: "SCHEDULED" } });
    const u1Before = await db.prisma.break.findFirst({ where: { userId: ids.u1, status: "SCHEDULED" } });
    expect(aliBefore).not.toBeNull();
    expect(u1Before).not.toBeNull();

    // Both members ready → group evaluation runs against live capacity
    await buddySvc.readyForGroupBreak(ids.u1, at(T0, 4));
    const res = await buddySvc.readyForGroupBreak(ids.ali, at(T0, 5));
    expect(res.started).toBe(false);
    expect((res as { waitingCapacity?: boolean }).waitingCapacity).toBe(true);
    // 4 running breaks end at T0+11 → first feasible group slot
    expect((res as { suggestedStart?: string }).suggestedStart).toBe(at(T0, 11).toISOString());

    // Members' own breaks are untouched — suggestions never mutate the queue
    const aliAfter = await db.prisma.break.findFirst({ where: { userId: ids.ali, status: "SCHEDULED" } });
    const u1After = await db.prisma.break.findFirst({ where: { userId: ids.u1, status: "SCHEDULED" } });
    expect(aliAfter!.scheduledStart.getTime()).toBe(aliBefore!.scheduledStart.getTime());
    expect(u1After!.scheduledStart.getTime()).toBe(u1Before!.scheduledStart.getTime());

    // Supervisor monitor sees the forming group + live capacity
    const monitor = await buddySvc.getGroupBreakMonitor();
    expect(monitor.enabled).toBe(true);
    expect(monitor.capacity.activeBreaks).toBe(4);
    expect(monitor.capacity.onlineAgents).toBe(6);
    const grp = monitor.groups.find((g) => g.members.some((m) => m.userId === ids.ali));
    expect(grp).toBeDefined();
    expect(grp!.totalCount).toBe(2);
  });

  it("load-ratio block (capacity raised) reports waitingLoad and points back to the normal break", async () => {
    await settingsSvc.updateSettings({ maxConcurrentBreaks: 9, maxGroupBreakLoadRatio: 0.3 });
    // Both members already in the forming group; re-ready triggers re-evaluation
    await buddySvc.readyForGroupBreak(ids.u1, at(T0, 6));
    const res = await buddySvc.readyForGroupBreak(ids.ali, at(T0, 6));
    expect(res.started).toBe(false);
    expect((res as { waitingLoad?: boolean }).waitingLoad).toBe(true);
    // With 6 online the load guard can't clear within the search window
    expect((res as { suggestedStart?: string }).suggestedStart).toBeUndefined();
  });

  it("matching window: state exposes only in-window suggestions, buddies first", async () => {
    await settingsSvc.updateSettings({ groupBreakEnabled: true, groupSuggestWindowMinutes: 10 });
    // u1's first scheduled break is T0+60; ali's own break is excluded
    const state = await stateSvc.getEmployeeState(ids.ali, at(T0, 55));
    expect(state.hasActiveShift).toBe(true);
    const sugg = state.suggestions ?? [];
    expect(sugg.length).toBeGreaterThan(0);
    const u1Match = sugg.find((s) => s.userId === ids.u1);
    expect(u1Match).toBeDefined();
    expect(u1Match!.isBuddy).toBe(true);
    expect(u1Match!.minutesUntilBreak).toBe(5);
    for (const s of sugg) expect(s.minutesUntilBreak).toBeLessThanOrEqual(10);
  });

  it("feature switch off → group ready refuses with a clear error; matching returns empty", async () => {
    await settingsSvc.updateSettings({ groupBreakEnabled: false });
    await expect(buddySvc.readyForGroupBreak(ids.ali, at(T0, 7))).rejects.toMatchObject({ status: 409 });
    const matches = await buddySvc.getBreakMatches(ids.ali, at(T0, 7));
    expect(matches.enabled).toBe(false);
    await settingsSvc.updateSettings({ groupBreakEnabled: true });
  });
});
