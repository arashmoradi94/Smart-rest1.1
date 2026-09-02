import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

process.env.DATABASE_URL = "file:./tmp-test.db";

const at = (base: Date, offsetMin: number) => new Date(base.getTime() + offsetMin * 60_000);

let db: typeof import("@/lib/db");
let reminder: typeof import("@/services/reminder-job");
let shiftSvc: typeof import("@/services/shift-service");
let breakSvc: typeof import("@/services/break-service");
let validators: typeof import("@/lib/validators");
let events: typeof import("@/lib/events");
let ids: Record<string, string> = {};

const T0 = new Date("2026-08-24T08:00:00.000Z");

beforeAll(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    if (fs.existsSync(`dev.db${ext}`)) fs.copyFileSync(`dev.db${ext}`, `tmp-test.db${ext}`);
  }
  db = await import("@/lib/db");
  await db.prisma.shift.updateMany({ where: { status: "ACTIVE" }, data: { status: "ENDED", endedAt: new Date() } });
  await db.prisma.break.updateMany({ where: { actualStart: { not: null }, actualEnd: null }, data: { actualEnd: new Date(), status: "COMPLETED" } });
  shiftSvc = await import("@/services/shift-service");
  breakSvc = await import("@/services/break-service");
  reminder = await import("@/services/reminder-job");
  validators = await import("@/lib/validators");
  events = await import("@/lib/events");
  const users = await db.prisma.user.findMany();
  ids = Object.fromEntries(users.map((u) => [u.username, u.id]));
});

afterAll(async () => {
  await db.prisma.$disconnect();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      if (fs.existsSync(`tmp-test.db${ext}`)) fs.rmSync(`tmp-test.db${ext}`);
    } catch {
      // Windows may hold the file briefly
    }
  }
});

describe("Reminder sweep (server-side push scheduling)", () => {
  it("sends early warning once, exactly at the configured window", async () => {
    await shiftSvc.startShift(ids.ali, T0);
    // settings: earlyNotificationMinutes=2 → break at T0+60m; at T0+58m it's due
    const r1 = await reminder.runReminderSweep(at(T0, 58));
    expect(r1.early).toBe(1);
    // Second sweep must not duplicate (flag claimed)
    const r2 = await reminder.runReminderSweep(at(T0, 59));
    expect(r2.early).toBe(0);
  });

  it("sends end warning and overdue once each during a running break", async () => {
    // Break scheduled at T0+60; start it 1 min early then sweep around the end.
    await breakSvc.startBreak(ids.ali, at(T0, 59));
    const state1 = await reminder.runReminderSweep(at(T0, 68)); // 1 min before fixed end (59+10)
    expect(state1.endWarn).toBe(1);
    expect((await reminder.runReminderSweep(at(T0, 68.5))).endWarn).toBe(0);

    const r3 = await reminder.runReminderSweep(at(T0, 70)); // past end
    expect(r3.overdue).toBe(1);
    expect((await reminder.runReminderSweep(at(T0, 71))).overdue).toBe(0);
  });

  it("ignores breaks of ended shifts", async () => {
    await shiftSvc.endShift(ids.ali, at(T0, 80));
    const r = await reminder.runReminderSweep(at(T0, 85));
    expect(r.early).toBe(0);
    expect(r.overdue).toBe(0);
  });
});

describe("Validators (zod schemas)", () => {
  it("accepts a valid settings update and rejects out-of-range values", () => {
    expect(() => validators.validate(validators.settingsUpdateSchema, { workDurationMinutes: 45 })).not.toThrow();
    expect(() => validators.validate(validators.settingsUpdateSchema, { workDurationMinutes: 5 })).toThrow();
    expect(() => validators.validate(validators.settingsUpdateSchema, { maxConcurrentBreaks: 0 })).toThrow();
    expect(() => validators.validate(validators.settingsUpdateSchema, { timezone: "Not/AZone" })).toThrow();
    expect(() => validators.validate(validators.settingsUpdateSchema, { timezone: "Asia/Tehran" })).not.toThrow();
  });

  it("enforces role whitelist and username format on user creation", () => {
    expect(() =>
      validators.validate(validators.createUserSchema, { name: "Ali", username: "ali1", password: "secret1", role: "EMPLOYEE" }),
    ).not.toThrow();
    expect(() =>
      validators.validate(validators.createUserSchema, { name: "Ali", username: "ali1", password: "secret1", role: "GOD" }),
    ).toThrow();
    expect(() =>
      validators.validate(validators.createUserSchema, { name: "Ali", username: "a", password: "secret1" }),
    ).toThrow();
    expect(() =>
      validators.validate(validators.createUserSchema, { name: "Ali", username: "ali1", password: "123" }),
    ).toThrow();
  });

  it("validates grant amounts and override actions", () => {
    expect(() => validators.validate(validators.grantSchema, { userId: "u1", amount: 50, reason: "great work" })).not.toThrow();
    expect(() => validators.validate(validators.grantSchema, { userId: "u1", amount: 0, reason: "x" })).toThrow();
    expect(() => validators.validate(validators.grantSchema, { userId: "u1", amount: 1500, reason: "x" })).toThrow();
    expect(() => validators.validate(validators.grantSchema, { userId: "u1", amount: 2.5, reason: "x" })).toThrow();
    expect(() => validators.validate(validators.overrideSchema, { userId: "u1", action: "start" })).not.toThrow();
    expect(() => validators.validate(validators.overrideSchema, { userId: "u1", action: "nuke" })).toThrow();
  });

  it("rejects malformed push subscriptions", () => {
    expect(() =>
      validators.validate(validators.pushSubscriptionSchema, {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "k", auth: "a" },
      }),
    ).not.toThrow();
    expect(() =>
      validators.validate(validators.pushSubscriptionSchema, { endpoint: "not-a-url", keys: { p256dh: "k", auth: "a" } }),
    ).toThrow();
  });
});

describe("Events pub/sub (SSE backbone)", () => {
  it("delivers events to matching topics only", () => {
    const got: string[] = [];
    const gotAdmin: string[] = [];
    const unsub1 = events.subscribe(["user:u1"], (e) => got.push(e.type));
    const unsub2 = events.subscribe(["admin"], (e) => gotAdmin.push(e.type));

    events.publishUserState("u1", "state");
    events.publishUserState("u2", "state");
    events.publishAdminState();

    expect(got).toEqual(["state"]);
    expect(gotAdmin).toEqual(["admin-state"]);

    unsub1();
    unsub2();
    events.publishUserState("u1", "state");
    expect(got).toEqual(["state"]); // unchanged after unsubscribe
  });

  it("publishStates notifies each user and the admin topic", () => {
    const seen: Record<string, number> = {};
    const unsubs = [
      events.subscribe(["user:a"], () => void (seen["a"] = (seen["a"] ?? 0) + 1)),
      events.subscribe(["user:b"], () => void (seen["b"] = (seen["b"] ?? 0) + 1)),
      events.subscribe(["admin"], () => void (seen["admin"] = (seen["admin"] ?? 0) + 1)),
    ];
    events.publishStates(["a", "b"]);
    expect(seen).toEqual({ a: 1, b: 1, admin: 1 });
    unsubs.forEach((u) => u());
  });
});
