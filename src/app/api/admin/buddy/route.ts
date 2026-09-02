import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { AppError } from "@/lib/utils";
import { adminSetBuddy } from "@/services/buddy-service";

/** Force link (sync) or unlink (unsync) two users as buddies. */
export async function POST(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const { userId, buddyId, link } = await readJson<{ userId?: string; buddyId?: string; link?: boolean }>(request);
    if (!userId || !buddyId || typeof link !== "boolean") throw new AppError("پارامتر نامعتبر");
    return Response.json(await adminSetBuddy(admin.id, userId, buddyId, link));
  } catch (e) {
    return errorResponse(e);
  }
}
