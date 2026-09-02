import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { getBreakMatches } from "@/services/buddy-service";

/** Break Matching — suggestion-only offers for the employee's dashboard. */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    return Response.json(await getBreakMatches(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
