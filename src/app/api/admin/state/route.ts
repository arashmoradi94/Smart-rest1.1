import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getAdminState } from "@/services/admin-service";

export async function GET(request: Request) {
  try {
    const user = await requireSupervisor();
    limit(request, user.id, "read");
    return Response.json(await getAdminState());
  } catch (e) {
    return errorResponse(e);
  }
}
