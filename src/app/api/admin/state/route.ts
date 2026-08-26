import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { getAdminState } from "@/services/admin-service";

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await getAdminState());
  } catch (e) {
    return errorResponse(e);
  }
}
