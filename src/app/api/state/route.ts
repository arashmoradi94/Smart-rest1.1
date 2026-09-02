import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getEmployeeState } from "@/services/state-service";
import { ensureReminderScheduler } from "@/services/reminder-job";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    ensureReminderScheduler();
    return Response.json(await getEmployeeState(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
