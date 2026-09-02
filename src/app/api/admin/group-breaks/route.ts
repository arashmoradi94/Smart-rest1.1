import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getGroupBreakMonitor } from "@/services/buddy-service";

/** Group Break Monitor: forming/active groups + live team capacity. */
export async function GET(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "read");
    return Response.json(await getGroupBreakMonitor());
  } catch (e) {
    return errorResponse(e);
  }
}
