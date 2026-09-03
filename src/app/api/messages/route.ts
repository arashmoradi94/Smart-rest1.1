import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getMyDirectMessages, markDirectMessageRead } from "@/services/message-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    return Response.json(await getMyDirectMessages(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const body = (await request.json()) as { messageId?: string };
    if (!body.messageId) return Response.json({ error: "شناسه پیام الزامی است" }, { status: 400 });
    return Response.json(await markDirectMessageRead(user.id, body.messageId));
  } catch (e) {
    return errorResponse(e);
  }
}
