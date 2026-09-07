import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { validate, historyQuerySchema } from "@/lib/validators";
import { getUserHistory } from "@/services/admin-service";

export async function GET(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "read");
    const url = new URL(request.url);
    const query = validate(historyQuerySchema, {
      userId: url.searchParams.get("userId"),
      days: url.searchParams.get("days") ?? "30",
      status: url.searchParams.get("status") ?? undefined,
    });
    const from = new Date(Date.now() - query.days * 24 * 3600 * 1000);
    return Response.json(await getUserHistory(query.userId, { from, status: query.status }));
  } catch (e) {
    return errorResponse(e);
  }
}
