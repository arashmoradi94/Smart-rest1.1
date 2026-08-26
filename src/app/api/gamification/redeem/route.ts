import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { AppError } from "@/lib/utils";
import { redeemReward, getCoinBalance } from "@/services/gamification-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const { rewardId } = await request.json();
    if (!rewardId) throw new AppError("rewardId الزامی است");
    await redeemReward(user.id, rewardId);
    return Response.json({ ok: true, balance: await getCoinBalance(user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
