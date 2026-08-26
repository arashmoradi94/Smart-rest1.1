import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { startShift } from "@/services/shift-service";

export async function POST() {
  try {
    const user = await requireAuth();
    return Response.json(await startShift(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
