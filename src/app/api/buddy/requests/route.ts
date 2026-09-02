import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, buddyRequestSchema } from "@/lib/validators";
import { sendBuddyRequest, listBuddies } from "@/services/buddy-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    return Response.json(await listBuddies(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { addresseeId } = validate(buddyRequestSchema, await readJson(request));
    return Response.json(await sendBuddyRequest(user.id, addresseeId));
  } catch (e) {
    return errorResponse(e);
  }
}
