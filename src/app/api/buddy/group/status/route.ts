import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getGroupBreakStatus } from "@/services/buddy-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    return Response.json(await getGroupBreakStatus(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
