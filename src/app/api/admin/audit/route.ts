import { requireAdmin } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { listAudit } from "@/services/admin-service";

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin();
    limit(request, admin.id, "read");
    const limitParam = Number(new URL(request.url).searchParams.get("limit") ?? "100");
    return Response.json(await listAudit(limitParam));
  } catch (e) {
    return errorResponse(e);
  }
}
