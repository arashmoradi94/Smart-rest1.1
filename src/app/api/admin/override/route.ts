import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, overrideSchema } from "@/lib/validators";
import { adminOverrideBreak } from "@/services/admin-service";

export async function POST(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const { userId, action } = validate(overrideSchema, await readJson(request));
    return Response.json(await adminOverrideBreak(admin.id, userId, action));
  } catch (e) {
    return errorResponse(e);
  }
}
