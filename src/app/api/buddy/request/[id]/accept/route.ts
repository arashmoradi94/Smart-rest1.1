import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { acceptBuddyRequest, cancelBuddyRequest } from "@/services/buddy-service";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth();
    return Response.json(await acceptBuddyRequest(params.id, user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth();
    return Response.json(await cancelBuddyRequest(params.id, user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
