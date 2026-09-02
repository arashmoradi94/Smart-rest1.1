import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, announcementSchema } from "@/lib/validators";
import { createAnnouncement, listForAdmin } from "@/services/announcement-service";

export async function GET(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "read");
    return Response.json(await listForAdmin());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const { message, targetUserIds } = validate(
      announcementSchema,
      await readJson(request),
    );
    return Response.json(await createAnnouncement(admin.id, message, targetUserIds ?? []));
  } catch (e) {
    return errorResponse(e);
  }
}
