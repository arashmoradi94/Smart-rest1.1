import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, id } from "@/lib/validators";
import { cancelBreakRequest } from "@/services/break-request-service";

const cancelSchema = z.object({ requestId: id });

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { requestId } = validate(cancelSchema, await readJson(request));
    return Response.json(await cancelBreakRequest(user.id, requestId));
  } catch (e) {
    return errorResponse(e);
  }
}
