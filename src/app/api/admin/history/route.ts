import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { AppError } from "@/lib/utils";
import { getUserHistory } from "@/services/admin-service";

export async function GET(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "read");
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!userId) throw new AppError("userId الزامی است");
    const days = Number(url.searchParams.get("days") ?? "30");
    const from = new Date(Date.now() - Math.min(365, Math.max(1, days)) * 24 * 3600 * 1000);
    const status = url.searchParams.get("status")?.split(",").filter(Boolean);
    return Response.json(await getUserHistory(userId, { from, status }));
  } catch (e) {
    return errorResponse(e);
  }
}
