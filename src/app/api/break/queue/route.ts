import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { cancelSmartBreakQueue, getSmartBreakQueueForUser, requestSmartBreakQueue } from "@/services/smart-break-queue";

export async function GET() {
  try {
    const user = await requireAuth();
    return Response.json(await getSmartBreakQueueForUser(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    return Response.json(await requestSmartBreakQueue(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    return Response.json(await cancelSmartBreakQueue(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
