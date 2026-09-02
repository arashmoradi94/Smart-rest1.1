import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { sendBuddyRequest, listIncomingRequests } from "@/services/buddy-service";

export async function POST(req: Request) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const { targetId } = body;
    if (!targetId) return new Response(JSON.stringify({ error: "targetId required" }), { status: 400 });
    return Response.json(await sendBuddyRequest(user.id, targetId));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET() {
  try {
    const user = await requireAuth();
    return Response.json(await listIncomingRequests(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
