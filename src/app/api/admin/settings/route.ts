import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { adminUpdateSettings } from "@/services/admin-service";
import { getSettings } from "@/services/settings-service";

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await getSettings());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await request.json();
    return Response.json(await adminUpdateSettings(user.id, body));
  } catch (e) {
    return errorResponse(e);
  }
}
