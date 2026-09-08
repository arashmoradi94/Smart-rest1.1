import { prisma } from "@/lib/db";
import { AppError } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { companyDayKey, previousCompanyDayKey } from "@/lib/time";
import { getSettings } from "@/services/settings-service";
import type { BadgeView } from "@/types";

export const COIN_RULES = {
  SHIFT_STARTED: 10,
  BREAK_ON_TIME: 5,
  RETURN_ON_TIME: 10,
  PERFECT_SHIFT: 20,
  GROUP_BREAK: 15,
  STREAK_BONUS: 5, // per 7-day streak milestone
} as const;

export const LEVEL_STEP = 100; // XP per level

function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(xp / LEVEL_STEP) + 1);
}

const userMutationTails = new Map<string, Promise<void>>();

async function withUserMutation<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = userMutationTails.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  userMutationTails.set(userId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (userMutationTails.get(userId) === queued) userMutationTails.delete(userId);
  }
}

/**
 * Server-side only. Idempotency via a prior identical transaction reason
 * (reason includes breakId/shiftId) — double-award is impossible.
 */
export async function awardCoins(
  userId: string,
  amount: number,
  reason: string,
): Promise<void> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AppError("مقدار امتیاز نامعتبر است", 400);
  }
  if (!reason.trim()) throw new AppError("دلیل امتیاز الزامی است", 400);

  await withUserMutation(userId, async () => {
    await prisma.$transaction(async (tx) => {
      const dup = await tx.coinTransaction.findFirst({
        where: { userId, reason },
        select: { id: true },
      });
      if (dup) return;

      const user = await tx.user.update({
        where: { id: userId },
        data: { xp: { increment: amount } },
        select: { xp: true },
      });
      await tx.coinTransaction.create({ data: { userId, amount, type: "EARN", reason } });
      await tx.user.update({ where: { id: userId }, data: { level: levelFromXp(user.xp) } });
    });
  });
}

/** Daily streak update on shift start — server-side, company-timezone day. */
export async function touchStreak(userId: string, now = new Date()): Promise<void> {
  let milestone: { todayKey: string; streak: number } | undefined;
  await withUserMutation(userId, async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastShiftDate: true, streakDays: true },
    });
    if (!user) return;
    const timezone = (await getSettings()).timezone;
    const todayKey = companyDayKey(now, timezone);
    const lastKey = user.lastShiftDate ? companyDayKey(user.lastShiftDate, timezone) : null;
    if (lastKey === todayKey) return;
    const streak = lastKey === previousCompanyDayKey(timezone, now)
      ? user.streakDays + 1
      : 1;
    await prisma.user.update({
      where: { id: userId },
      data: { lastShiftDate: now, streakDays: streak },
    });
    if (streak > 0 && streak % 7 === 0) milestone = { todayKey, streak };
  });
  // Milestone bonus every 7 consecutive days, after the streak lock is released.
  if (milestone) {
    await awardCoins(userId, COIN_RULES.STREAK_BONUS, `STREAK:${milestone.todayKey}:${milestone.streak}`).catch(() => {});
  }
}

export async function getCoinBalance(userId: string): Promise<number> {
  const agg = await prisma.coinTransaction.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

/** Admin/supervisor: manually grant (or deduct with negative amount) coins/XP. */
export async function grantCoins(
  adminId: string,
  userId: string,
  amount: number,
  reason: string,
): Promise<void> {
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000) {
    throw new AppError("مقدار امتیاز نامعتبر است", 400);
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("کاربر یافت نشد", 404);
  await withUserMutation(userId, async () => {
    await prisma.$transaction(async (tx) => {
      const updated = amount > 0
        ? await tx.user.update({
            where: { id: userId },
            data: { xp: { increment: amount } },
            select: { xp: true },
          })
        : null;
      await tx.coinTransaction.create({
        data: { userId, amount, type: amount > 0 ? "GRANT" : "PENALTY", reason: `ADMIN:${reason}` },
      });
      if (updated) {
        await tx.user.update({ where: { id: userId }, data: { level: levelFromXp(updated.xp) } });
      }
    });
  });
  await logAudit(adminId, amount > 0 ? "GRANT_COINS" : "DEDUCT_COINS", `${userId} ${amount} (${reason})`);
  const { publishUserState } = await import("@/lib/events");
  publishUserState(userId, "gamification");
}

export async function redeemReward(
  userId: string,
  rewardId: string,
): Promise<{ ok: true }> {
  const outcome = await withUserMutation(userId, () => prisma.$transaction(async (tx) => {
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

      const redemption = await tx.rewardRedemption.create({
        data: { rewardId, userId, coinSpent: reward.coinCost },
      });
      await tx.coinTransaction.create({
        data: {
          userId,
          amount: -reward.coinCost,
          type: "SPEND",
          reason: `REWARD:${reward.id}:${redemption.id}`,
        },
      });
      return { name: reward.name, coinCost: reward.coinCost };
    }));
  await logAudit(userId, "REWARD_REDEEM", `${outcome.name} (${outcome.coinCost} coins)`);
  const { publishUserState } = await import("@/lib/events");
  publishUserState(userId, "gamification");
  return { ok: true as const };
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

/** Daily/weekly/monthly leaderboard — ranks only positive stats, no shaming. */
export async function getLeaderboard(
  period: "day" | "week" | "month",
  now = new Date(),
): Promise<LeaderboardRow[]> {
  const windowDays = period === "day" ? 1 : period === "week" ? 7 : 30;
  const since = new Date(now.getTime() - windowDays * 24 * 3600_000);

  const users = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    select: {
      id: true,
      name: true,
      streakDays: true,
      coinTransactions: {
        where: { createdAt: { gte: since }, type: { in: ["EARN", "GRANT"] } },
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

/** Badges are derived server-side from real stats — client cannot fake them. */
export async function getBadges(userId: string): Promise<BadgeView[]> {
  const [user, perfectCount, onTimeCount, groupCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { level: true, streakDays: true },
    }),
    prisma.coinTransaction.count({ where: { userId, reason: { startsWith: "PERFECT:" } } }),
    prisma.coinTransaction.count({ where: { userId, reason: { startsWith: "RETURN_ONTIME:" } } }),
    prisma.break.count({
      where: { userId, groupBreakId: { not: null }, status: "COMPLETED" },
    }),
  ]);

  const defs: Array<{ key: string; label: string; icon: string; earned: boolean }> = [
    { key: "first-return", label: "اولین بازگشت به‌موقع", icon: "🎯", earned: onTimeCount >= 1 },
    { key: "ontime-10", label: "۱۰ بازگشت به‌موقع", icon: "⏰", earned: onTimeCount >= 10 },
    { key: "ontime-50", label: "۵۰ بازگشت به‌موقع", icon: "🏅", earned: onTimeCount >= 50 },
    { key: "perfect-1", label: "شیفت بی‌نقص", icon: "✨", earned: perfectCount >= 1 },
    { key: "perfect-10", label: "۱۰ شیفت بی‌نقص", icon: "🌟", earned: perfectCount >= 10 },
    { key: "streak-7", label: "۷ روز پیوسته", icon: "🔥", earned: (user?.streakDays ?? 0) >= 7 },
    { key: "streak-30", label: "۳۰ روز پیوسته", icon: "💎", earned: (user?.streakDays ?? 0) >= 30 },
    { key: "level-5", label: "سطح ۵", icon: "🚀", earned: (user?.level ?? 1) >= 5 },
    { key: "level-10", label: "سطح ۱۰", icon: "👑", earned: (user?.level ?? 1) >= 10 },
    { key: "team-player", label: "بازی تیمی (۵ استراحت گروهی)", icon: "🤝", earned: groupCount >= 5 },
  ];
  return defs.map(({ key, label, icon, earned }) => ({ key, label, icon, earned }));
}
