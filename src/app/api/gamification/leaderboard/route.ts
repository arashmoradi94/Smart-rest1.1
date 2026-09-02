import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getLeaderboard } from "@/services/gamification-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    const p = new URL(request.url).searchParams.get("period");
    const period = p === "day" || p === "month" ? p : "week";
    return Response.json(await getLeaderboard(period));
  } catch (e) {
    return errorResponse(e);
  }
}
