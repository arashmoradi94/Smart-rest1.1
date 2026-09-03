import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getDinnerSchedule, publishDinnerSchedule, saveDinnerSchedule } from "@/services/dinner-service";

export async function GET(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "read");
    const month = new URL(request.url).searchParams.get("month");
    if (!month) return Response.json({ error: "ماه الزامی است" }, { status: 400 });
    return Response.json(await getDinnerSchedule(month));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    return Response.json(await saveDinnerSchedule(await request.json()));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const body = (await request.json()) as { monthKey?: string; published?: boolean };
    if (!body.monthKey || typeof body.published !== "boolean") {
      return Response.json({ error: "اطلاعات انتشار نامعتبر است" }, { status: 400 });
    }
    return Response.json(await publishDinnerSchedule(body.monthKey, body.published));
  } catch (e) {
    return errorResponse(e);
  }
}
