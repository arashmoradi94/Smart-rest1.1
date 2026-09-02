import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, grantSchema } from "@/lib/validators";
import { grantCoins } from "@/services/gamification-service";

export async function POST(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const { userId, amount, reason } = validate(grantSchema, await readJson(request));
    await grantCoins(admin.id, userId, amount, reason);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
