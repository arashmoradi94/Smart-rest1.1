import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { readyForGroupBreak } from "@/services/buddy-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    return Response.json(await readyForGroupBreak(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
