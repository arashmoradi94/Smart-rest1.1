import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getTodayDinner } from "@/services/dinner-service";
import { companyDayKey } from "@/lib/time";
import { getSettings } from "@/services/settings-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    const settings = await getSettings();
    return Response.json(await getTodayDinner(user.id, companyDayKey(new Date(), settings.timezone)));
  } catch (e) {
    return errorResponse(e);
  }
}
