import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getEmployeeRecipients, sendDirectMessage } from "@/services/message-service";

export async function GET(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "read");
    return Response.json(await getEmployeeRecipients());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const body = (await request.json()) as { recipientId?: string; message?: string };
    if (!body.recipientId || typeof body.message !== "string") {
      return Response.json({ error: "گیرنده و متن پیام الزامی است" }, { status: 400 });
    }
    return Response.json(await sendDirectMessage(admin.id, body.recipientId, body.message));
  } catch (e) {
    return errorResponse(e);
  }
}
