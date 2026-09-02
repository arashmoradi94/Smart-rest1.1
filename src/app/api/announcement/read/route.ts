import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate } from "@/lib/validators";
import { markRead } from "@/services/announcement-service";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { announcementId } = validate(
      z.object({ announcementId: z.string().min(1).max(64) }),
      await readJson(request),
    );
    return Response.json(await markRead(user.id, announcementId));
  } catch (e) {
    return errorResponse(e);
  }
}
