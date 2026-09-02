import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, pushSubscriptionSchema } from "@/lib/validators";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const sub = validate(pushSubscriptionSchema, await readJson(request));
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        userId: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
      },
      update: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    await logAudit(user.id, "PUSH_SUBSCRIBE", sub.endpoint.slice(0, 60));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const { endpoint } = await readJson<{ endpoint?: string }>(request);
    if (endpoint) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
      await logAudit(user.id, "PUSH_UNSUBSCRIBE", endpoint.slice(0, 60));
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
