import { requireAdmin } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, settingsUpdateSchema } from "@/lib/validators";
import { adminUpdateSettings } from "@/services/admin-service";
import { getSettings } from "@/services/settings-service";

export async function GET(request: Request) {
  try {
    const user = await requireAdmin();
    limit(request, user.id, "read");
    return Response.json(await getSettings());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireAdmin();
    limit(request, user.id, "write");
    const input = validate(settingsUpdateSchema, await readJson(request));
    return Response.json(await adminUpdateSettings(user.id, input));
  } catch (e) {
    return errorResponse(e);
  }
}
