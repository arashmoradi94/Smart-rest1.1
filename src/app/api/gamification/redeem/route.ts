import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, redeemSchema } from "@/lib/validators";
import { redeemReward, getCoinBalance } from "@/services/gamification-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { rewardId } = validate(redeemSchema, await readJson(request));
    await redeemReward(user.id, rewardId);
    return Response.json({ ok: true, balance: await getCoinBalance(user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
