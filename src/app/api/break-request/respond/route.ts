import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, breakRequestRespondSchema } from "@/lib/validators";
import { respondBreakRequest } from "@/services/break-request-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { requestId, accept } = validate(breakRequestRespondSchema, await readJson(request));
    return Response.json(await respondBreakRequest(user.id, requestId, accept));
  } catch (e) {
    return errorResponse(e);
  }
}
