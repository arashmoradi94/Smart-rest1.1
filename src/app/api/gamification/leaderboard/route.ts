import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { getLeaderboard } from "@/services/gamification-service";

export async function GET(request: Request) {
  try {
    await requireAuth();
    const period = new URL(request.url).searchParams.get("period") === "month" ? "month" : "week";
    return Response.json(await getLeaderboard(period));
  } catch (e) {
    return errorResponse(e);
  }
}
