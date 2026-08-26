import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { startBreak } from "@/services/break-service";

export async function POST() {
  try {
    const user = await requireAuth();
    return Response.json(await startBreak(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
