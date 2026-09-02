import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { AppError } from "@/lib/utils";
import { cancelBuddyRequest } from "@/services/buddy-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { requestId } = await readJson<{ requestId?: string }>(request);
    if (!requestId) throw new AppError("پارامتر نامعتبر", 400);
    return Response.json(await cancelBuddyRequest(user.id, requestId));
  } catch (e) {
    return errorResponse(e);
  }
}
