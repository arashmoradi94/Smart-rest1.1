import { prisma } from "@/lib/db";
import { errorResponse, limit, readJson } from "@/lib/api";
import { requireAuth, isTeamLead } from "@/lib/auth";
import { validate, callStatusSchema } from "@/lib/validators";
import { logAudit } from "@/lib/audit";
import { publishStates } from "@/lib/events";

/** Employee toggles their own on-call flag; team leads can set it for anyone. */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { onCall, userId: targetUserId } = validate(callStatusSchema, await readJson(request));
    const targetId = isTeamLead(user.role) && targetUserId ? targetUserId : user.id;
    await prisma.user.update({ where: { id: targetId }, data: { onCall } });
    if (targetId !== user.id) {
      await logAudit(user.id, "SET_CALL_STATUS", `${targetId} onCall:${onCall}`);
    } else {
      await logAudit(user.id, "TOGGLE_CALL_STATUS", `onCall:${onCall}`);
    }
    publishStates([targetId]);
    return Response.json({ ok: true, onCall });
  } catch (e) {
    return errorResponse(e);
  }
}
