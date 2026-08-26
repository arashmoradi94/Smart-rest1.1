import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { endShift } from "@/services/shift-service";

export async function POST() {
  try {
    const user = await requireAuth();
    return Response.json(await endShift(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
