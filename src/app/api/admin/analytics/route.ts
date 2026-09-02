import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getTeamAnalytics } from "@/services/admin-service";

export async function GET(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "read");
    const p = new URL(request.url).searchParams.get("period");
    const period = p === "week" || p === "month" ? p : "day";
    return Response.json(await getTeamAnalytics(period));
  } catch (e) {
    return errorResponse(e);
  }
}
