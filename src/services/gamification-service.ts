import { prisma } from "@/lib/db";
import { AppError } from "@/lib/utils";
import { logAudit } from "@/lib/audit";

export const COIN_RULES = {
  SHIFT_STARTED: 10,
  BREAK_ON_TIME: 5,
  RETURN_ON_TIME: 10,
  PERFECT_SHIFT: 20,
} as const;

export const LEVEL_STEP = 100; // XP per level

function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(xp / LEVEL_STEP) + 1);
}

/**
 * Server-side only. Idempotency is caller's duty via unique reason per event
 * (reason includes breakId/shiftId). Double-award impossible by checking a
 * prior identical transaction.
 */
export async function awardCoins(
  userId: string,
  amount: number,
  reason: string,
): Promise<void> {
  if (amount === 0) return;
  const dup = await prisma.coinTransaction.findFirst({
    where: { userId, reason },
    select: { id: true },
  });
  if (dup) return;
  await prisma.$transaction([
    prisma.coinTransaction.create({ data: { userId, amount, type: "EARN", reason } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        xp: { increment: amount },
        ...(amount > 0 ? {} : {}),
      },
    }),
  ]);
  // Recompute level from total XP
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { xp: true } });
  if (user) {
    const level = levelFromXp(user.xp);
    if (level !== Math.max(1, Math.floor((user.xp - amount) / LEVEL_STEP) + 1)) {
      await prisma.user.update({ where: { id: userId }, data: { level } });
    }
  }
}

/** Daily streak update on shift start — server-side, based on server date */
export async function touchStreak(userId: string, now = new Date()): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastShiftDate: true, streakDays: true },
  });
  if (!user) return;
  const dayMs = 24 * 60 * 60 * 1000;
  const dayOf = (d: Date) => Math.floor(d.getTime() / dayMs);
  const today = dayOf(now);
  const last = user.lastShiftDate ? dayOf(user.lastShiftDate) : null;
  if (last === today) return;
  const streak = last !== null && today - last === 1 ? user.streakDays + 1 : 1;
  await prisma.user.update({
    where: { id: userId },
    data: { lastShiftDate: now, streakDays: streak },
  });
}

export async function getCoinBalance(userId: string): Promise<number> {
  const agg = await prisma.coinTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

export async function redeemReward(
  userId: string,
  rewardId: string,
): Promise<{ ok: true }> {
  return prisma.$transaction(async (tx) => {
    const reward = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!reward || !reward.active) throw new AppError("پاداش در دسترس نیست", 404);

    if (reward.limitCount !== null) {
      const count = await tx.rewardRedemption.count({ where: { rewardId } });
      if (count >= reward.limitCount) throw new AppError("ظرفیت این پاداش تمام شده است", 409);
    }

    const agg = await tx.coinTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    const balance = agg._sum.amount ?? 0;
    if (balance < reward.coinCost) throw new AppError("موجودی سکه کافی نیست", 409);

    await tx.coinTransaction.create({
      data: { userId, amount: -reward.coinCost, type: "SPEND", reason: `REWARD:${reward.id}` },
    });
    await tx.rewardRedemption.create({
      data: { rewardId, userId, coinSpent: reward.coinCost },
    });
    return { ok: true as const };
  });
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  name: string;
  coins: number;
  onTimeBreaks: number;
  lateBreaks: number;
  streakDays: number;
}

/** Weekly/Monthly leaderboard — ranks only positive stats, no shaming. */
export async function getLeaderboard(
  period: "week" | "month",
  now = new Date(),
): Promise<LeaderboardRow[]> {
  const since = new Date(now);
  if (period === "week") since.setDate(since.getDate() - 7);
  else since.setMonth(since.getMonth() - 1);

  const users = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    select: {
      id: true,
      name: true,
      streakDays: true,
      coinTransactions: {
        where: { createdAt: { gte: since }, type: "EARN" },
        select: { amount: true },
      },
      breaks: {
        where: {
          shift: { startedAt: { gte: since } },
          status: { in: ["COMPLETED", "LATE"] },
        },
        select: { status: true, endDelayMinutes: true },
      },
    },
  });

  const rows: Omit<LeaderboardRow, "rank">[] = users.map((u) => ({
    userId: u.id,
    name: u.name,
    coins: u.coinTransactions.reduce((s, t) => s + t.amount, 0),
    onTimeBreaks: u.breaks.filter((b) => b.endDelayMinutes === 0 && b.status === "COMPLETED").length,
    lateBreaks: u.breaks.filter((b) => b.status === "LATE" || b.endDelayMinutes > 0).length,
    streakDays: u.streakDays,
  }));

  rows.sort((a, b) => b.coins - a.coins || b.onTimeBreaks - a.onTimeBreaks);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
