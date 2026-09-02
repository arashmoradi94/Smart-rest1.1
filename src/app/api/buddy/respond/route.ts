import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, buddyRespondSchema } from "@/lib/validators";
import { respondBuddyRequest } from "@/services/buddy-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { requestId, accept } = validate(buddyRespondSchema, await readJson(request));
    return Response.json(await respondBuddyRequest(user.id, requestId, accept));
  } catch (e) {
    return errorResponse(e);
  }
}
