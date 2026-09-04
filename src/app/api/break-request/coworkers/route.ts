import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { listSameShiftCoworkers } from "@/services/break-request-service";

/**
 * Authorized recipient set for a break invitation: employees currently on an
 * ACTIVE shift (excluding the caller). Enforced server-side — hiding options
 * in the UI is never the only guard.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    return Response.json(await listSameShiftCoworkers(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
