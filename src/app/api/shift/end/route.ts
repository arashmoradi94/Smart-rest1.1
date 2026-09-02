import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { endShift } from "@/services/shift-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    return Response.json(await endShift(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
