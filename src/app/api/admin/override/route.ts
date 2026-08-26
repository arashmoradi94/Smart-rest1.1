import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { AppError } from "@/lib/utils";
import { adminOverrideBreak } from "@/services/admin-service";

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const { userId, action } = await request.json();
    if (!userId || !action) throw new AppError("userId و action الزامی است");
    return Response.json(await adminOverrideBreak(admin.id, userId, action));
  } catch (e) {
    return errorResponse(e);
  }
}
