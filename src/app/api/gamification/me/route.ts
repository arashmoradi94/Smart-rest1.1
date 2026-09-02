import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getCoinBalance, getBadges } from "@/services/gamification-service";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    const [balance, profile, badges] = await Promise.all([
      getCoinBalance(user.id),
      prisma.user.findUnique({
        where: { id: user.id },
        select: { xp: true, level: true, streakDays: true },
      }),
      getBadges(user.id),
    ]);
    const weekly = await prisma.coinTransaction.aggregate({
      where: {
        userId: user.id,
        type: { in: ["EARN", "GRANT"] },
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
      badges,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
