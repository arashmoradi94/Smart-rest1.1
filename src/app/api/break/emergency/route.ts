import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { startEmergencyBreak } from "@/services/break-service";

const REASONS = new Set(["RESTROOM", "ILLNESS", "URGENT_REST", "OTHER"]);

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const body = (await request.json()) as { reason?: string; note?: string };
    if (!body.reason || !REASONS.has(body.reason)) {
      return Response.json({ error: "دلیل استراحت اضطراری را انتخاب کنید" }, { status: 400 });
    }
    return Response.json(await startEmergencyBreak(user.id, body.reason as "RESTROOM" | "ILLNESS" | "URGENT_REST" | "OTHER", body.note));
  } catch (e) {
    return errorResponse(e);
  }
}
