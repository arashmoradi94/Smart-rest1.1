import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { getEmployeeState } from "@/services/state-service";

export async function GET() {
  try {
    const user = await requireAuth();
    return Response.json(await getEmployeeState(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
