import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, buddyRemoveSchema } from "@/lib/validators";
import { removeBuddy } from "@/services/buddy-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { buddyId } = validate(buddyRemoveSchema, await readJson(request));
    return Response.json(await removeBuddy(user.id, buddyId));
  } catch (e) {
    return errorResponse(e);
  }
}
