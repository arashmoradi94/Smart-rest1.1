import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { setMemberReady, setMemberUnready } from "@/services/buddy-service";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth();
    return Response.json(await setMemberReady(params.id, user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth();
    return Response.json(await setMemberUnready(params.id, user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
