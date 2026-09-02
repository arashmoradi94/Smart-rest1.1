import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, adminBreakSchema } from "@/lib/validators";
import { cancelBreak, extendBreak } from "@/services/break-service";

/** Admin break controls: extend a running break / cancel a scheduled one. */
export async function POST(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const { breakId, action, minutes } = validate(adminBreakSchema, await readJson(request));
    if (action === "extend") {
      return Response.json(await extendBreak(admin.id, breakId, minutes));
    }
    return Response.json(await cancelBreak(admin.id, breakId));
  } catch (e) {
    return errorResponse(e);
  }
}
