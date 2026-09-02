import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { startBreak } from "@/services/break-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    return Response.json(await startBreak(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
