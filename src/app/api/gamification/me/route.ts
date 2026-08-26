import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { getCoinBalance } from "@/services/gamification-service";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const user = await requireAuth();
    const [balance, profile] = await Promise.all([
      getCoinBalance(user.id),
      prisma.user.findUnique({
        where: { id: user.id },
        select: { xp: true, level: true, streakDays: true },
      }),
    ]);
    const weekly = await prisma.coinTransaction.aggregate({
      where: {
        userId: user.id,
        type: "EARN",
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
      },
      _sum: { amount: true },
    });
    return Response.json({
      balance,
      xp: profile?.xp ?? 0,
      level: profile?.level ?? 1,
      streakDays: profile?.streakDays ?? 0,
      weeklyCoins: weekly._sum.amount ?? 0,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
