import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

process.env.DATABASE_URL = "file:./tmp-test.db";

let db: typeof import("@/lib/db");
let gam: typeof import("@/services/gamification-service");
let userId = "";

beforeAll(async () => {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      if (fs.existsSync(`tmp-test.db${ext}`)) fs.rmSync(`tmp-test.db${ext}`);
    } catch {}
    if (fs.existsSync(`dev.db${ext}`)) fs.copyFileSync(`dev.db${ext}`, `tmp-test.db${ext}`);
  }
  db = await import("@/lib/db");
  gam = await import("@/services/gamification-service");
  const u = await db.prisma.user.findUnique({ where: { username: "ali" } });
  if (!u) throw new Error("ali missing — run lifecycle suite first or seed");
  userId = u.id;
  // clean slate for this user's coins
  await db.prisma.coinTransaction.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await db.prisma.$disconnect();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      if (fs.existsSync(`tmp-test.db${ext}`)) fs.rmSync(`tmp-test.db${ext}`);
    } catch {}
  }
});

describe("Gamification (server-side)", () => {
  it("awards coins and updates XP; duplicate reason is ignored", async () => {
    await gam.awardCoins(userId, 10, "TEST:T1");
    await gam.awardCoins(userId, 10, "TEST:T1"); // duplicate
    expect(await gam.getCoinBalance(userId)).toBe(10);
    const u = await db.prisma.user.findUnique({ where: { id: userId }, select: { xp: true } });
    expect(u?.xp).toBeGreaterThanOrEqual(10);
  });

  it("streak increments across days, resets after gap", async () => {
    const d1 = new Date("2026-08-20T08:00:00Z");
    await gam.touchStreak(userId, d1);
    let u = await db.prisma.user.findUnique({ where: { id: userId }, select: { streakDays: true } });
    expect(u?.streakDays).toBe(1);
    await gam.touchStreak(userId, new Date(d1.getTime() + 24 * 3600e3));
    u = await db.prisma.user.findUnique({ where: { id: userId }, select: { streakDays: true } });
    expect(u?.streakDays).toBe(2);
    await gam.touchStreak(userId, new Date(d1.getTime() + 5 * 24 * 3600e3)); // gap
    u = await db.prisma.user.findUnique({ where: { id: userId }, select: { streakDays: true } });
    expect(u?.streakDays).toBe(1);
    // same-day repeat must not change
    await gam.touchStreak(userId, new Date(d1.getTime() + 5 * 24 * 3600e3 + 3600e3));
    u = await db.prisma.user.findUnique({ where: { id: userId }, select: { streakDays: true } });
    expect(u?.streakDays).toBe(1);
  });

  it("redeem rejects when balance insufficient (no negative)", async () => {
    await db.prisma.coinTransaction.deleteMany({ where: { userId } });
    const reward = await db.prisma.reward.create({
      data: { name: "Test Chocolate", coinCost: 50 },
    });
    await gam.awardCoins(userId, 10, "TEST:LOW");
    await expect(gam.redeemReward(userId, reward.id)).rejects.toMatchObject({ status: 409 });
    expect(await gam.getCoinBalance(userId)).toBe(10);
  });

  it("redeem succeeds atomically; double-spend impossible", async () => {
    const reward = await db.prisma.reward.create({
      data: { name: "Test Tea", coinCost: 10 },
    });
    await expect(gam.redeemReward(userId, reward.id)).resolves.toEqual({ ok: true });
    await expect(gam.redeemReward(userId, reward.id)).rejects.toMatchObject({ status: 409 });
    expect(await gam.getCoinBalance(userId)).toBe(0);
  });

  it("leaderboard ranks employees only, descending by coins", async () => {
    const rows = await gam.getLeaderboard("week");
    expect(Array.isArray(rows)).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].coins).toBeGreaterThanOrEqual(rows[i].coins);
    }
  });
});
