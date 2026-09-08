import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, pushSubscriptionSchema, pushUnsubscribeSchema } from "@/lib/validators";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    const sub = validate(pushSubscriptionSchema, await readJson(request));
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: sub.endpoint } });
    if (existing && existing.userId !== user.id) {
      throw new AppError("این اشتراک متعلق به کاربر دیگری است", 409);
    }
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
    const { endpoint } = validate(pushUnsubscribeSchema, await readJson(request));
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    await logAudit(user.id, "PUSH_UNSUBSCRIBE", endpoint.slice(0, 60));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
