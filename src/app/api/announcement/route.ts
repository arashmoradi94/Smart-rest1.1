import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getLatestForUser } from "@/services/announcement-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    return Response.json(await getLatestForUser(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
