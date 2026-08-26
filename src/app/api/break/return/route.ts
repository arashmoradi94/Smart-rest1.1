import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { returnToWork } from "@/services/break-service";

export async function POST() {
  try {
    const user = await requireAuth();
    return Response.json(await returnToWork(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
