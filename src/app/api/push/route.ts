import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { AppError } from "@/lib/utils";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const sub = await request.json();
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      throw new AppError("اشتراک نامعتبر است");
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
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAuth();
    const { endpoint } = await request.json();
    if (endpoint) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
