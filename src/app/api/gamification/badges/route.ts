import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getBadges } from "@/services/gamification-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    return Response.json(await getBadges(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
