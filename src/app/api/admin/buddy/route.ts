import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, adminBuddySchema } from "@/lib/validators";
import { adminSetBuddy } from "@/services/buddy-service";

/** Force link (sync) or unlink (unsync) two users as buddies. */
export async function POST(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const { userId, buddyId, link } = validate(adminBuddySchema, await readJson(request));
    return Response.json(await adminSetBuddy(admin.id, userId, buddyId, link));
  } catch (e) {
    return errorResponse(e);
  }
}
