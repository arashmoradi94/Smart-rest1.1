import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, breakRequestSchema } from "@/lib/validators";
import { listBreakRequests, sendBreakRequest } from "@/services/break-request-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    return Response.json(await listBreakRequests(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { recipientId } = validate(breakRequestSchema, await readJson(request));
    return Response.json(await sendBreakRequest(user.id, recipientId));
  } catch (e) {
    return errorResponse(e);
  }
}
