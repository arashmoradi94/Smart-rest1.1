import { prisma } from "@/lib/db";
import { AppError } from "@/lib/utils";
import { publishUserState } from "@/lib/events";
import { getActiveShift } from "@/services/shift-service";

/**
 * Same-shift break requests (acceptance item 2).
 *
 * Employee A asks employee B to take the upcoming break together. The request
 * is a PENDING record both sides can see; only the RECIPIENT may accept or
 * reject it (server-side enforced — a forged request id from anyone else is a
 * 404). Both employees must hold an ACTIVE shift at send AND at respond time,
 * so a request never leaks to someone outside the shift. Accepting does NOT
 * reschedule or start anything: it links the two through the existing buddy
 * group ready-sync, whose rules (capacity, on-call, shared timestamp) stay
 * exactly as before.
 */

/** May A send a break request to B? Only employees on an active shift. */
async function assertSameShiftPair(senderId: string, recipientId: string) {
  if (senderId === recipientId) throw new AppError("نمی‌توانید به خودتان درخواست بدهید", 400);
  const [sender, recipient] = await Promise.all([
    prisma.user.findUnique({ where: { id: senderId } }),
    prisma.user.findUnique({ where: { id: recipientId } }),
  ]);
  if (!recipient) throw new AppError("کاربر مورد نظر یافت نشد", 404);
  if (recipient.role !== "EMPLOYEE" || sender?.role !== "EMPLOYEE") {
    throw new AppError("درخواست استراحت فقط بین کارکنان امکان‌پذیر است", 403);
  }
  const [senderShift, recipientShift] = await Promise.all([
    getActiveShift(senderId),
    getActiveShift(recipientId),
  ]);
  if (!senderShift) throw new AppError("ابتدا شیفت خود را شروع کنید", 409);
  if (!recipientShift) throw new AppError("هم‌شیفتی مورد نظر شیفت فعالی ندارد", 409);
  return { senderShift, recipientShift };
}

/** The sender's next not-yet-started break (what the invitation refers to). */
async function nextScheduledBreak(userId: string) {
  const shift = await getActiveShift(userId);
  if (!shift) return null;
  return (
    shift.breaks.find((b) => b.status === "SCHEDULED" && b.kind !== "EMERGENCY") ?? null
  );
}

export async function sendBreakRequest(senderId: string, recipientId: string) {
  await assertSameShiftPair(senderId, recipientId);

  // One live request per direction; the DB unique key is the hard guard, this
  // check just gives a friendlier error.
  const pending = await prisma.breakRequest.findFirst({
    where: {
      status: "PENDING",
      OR: [
        { senderId, recipientId },
        { senderId: recipientId, recipientId: senderId },
      ],
    },
  });
  if (pending) throw new AppError("درخواست استراحت بین شما دو نفر در انتظار پاسخ است", 409);

  const senderBreak = await nextScheduledBreak(senderId);
  if (!senderBreak) throw new AppError("استراحت برنامه‌ریزی‌شده‌ای برای دعوت وجود ندارد", 409);

  // One row per pair: a resolved invitation is flipped back to PENDING by a
  // fresh one (new break, new reason) instead of creating duplicates.
  const existing = await prisma.breakRequest.findUnique({
    where: { senderId_recipientId: { senderId, recipientId } },
  });
  if (existing) {
    await prisma.breakRequest.update({
      where: { id: existing.id },
      data: { status: "PENDING", createdAt: new Date(), respondedAt: null },
    });
  } else {
    await prisma.breakRequest.create({
      data: { senderId, recipientId, status: "PENDING" },
    });
  }
  const { logAudit } = await import("@/lib/audit");
  await logAudit(senderId, "BREAK_REQUEST", `to:${recipientId} break:${senderBreak.id}`);
  // Recipient sees the invitation immediately (SSE nudge + push)
  publishUserState(recipientId, "break-request");
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(recipientId, {
    title: "☕ درخواست استراحت",
    body: "هم‌شیفتی از شما خواست همزمان استراحت کنید.",
    tag: "break-request",
    kind: "announcement",
    url: "/dashboard",
  }).catch(() => {});
  return { ok: true };
}

/** Everything the employee dashboard needs about break invitations. */
export async function listBreakRequests(userId: string) {
  const [incoming, outgoing] = await Promise.all([
    prisma.breakRequest.findMany({
      where: { recipientId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { sender: { select: { id: true, name: true, status: true } } },
    }),
    prisma.breakRequest.findMany({
      where: { senderId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { recipient: { select: { id: true, name: true, status: true } } },
    }),
  ]);
  return {
    incoming: incoming.map((r) => ({
      id: r.id,
      from: r.sender.name,
      fromId: r.senderId,
      createdAt: r.createdAt.toISOString(),
    })),
    outgoing: outgoing.map((r) => ({
      id: r.id,
      to: r.recipient.name,
      toId: r.recipientId,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function respondBreakRequest(userId: string, requestId: string, accept: boolean) {
  const req = await prisma.breakRequest.findUnique({ where: { id: requestId } });
  // Only the recipient can answer — the sender must not accept/reject on
  // their behalf, and an unknown/forged id must not leak its existence.
  if (!req || req.recipientId !== userId) throw new AppError("درخواست یافت نشد", 404);
  if (req.status !== "PENDING") throw new AppError("این درخواست قبلاً پاسخ داده شده است", 409);

  if (!accept) {
    const res = await prisma.breakRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "REJECTED", respondedAt: new Date() },
    });
    if (res.count !== 1) throw new AppError("این درخواست قبلاً پاسخ داده شده است", 409);
    const { logAudit } = await import("@/lib/audit");
    await logAudit(userId, "BREAK_REQUEST_RESPONSE", `rejected request:${requestId}`);
    publishUserState(req.senderId, "break-request");
    return { ok: true, accepted: false };
  }

  // Accept: both must STILL be on an active shift; otherwise the invitation
  // can no longer be honoured and is rejected instead of hanging forever.
  await assertSameShiftPair(req.senderId, req.recipientId).catch(() => {
    throw new AppError("شیفت یکی از شما دو نفر پایان یافته است", 409);
  });

  const res = await prisma.breakRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (res.count !== 1) throw new AppError("این درخواست قبلاً پاسخ داده شده است", 409);
  const { logAudit } = await import("@/lib/audit");
  await logAudit(userId, "BREAK_REQUEST_RESPONSE", `accepted request:${requestId}`);
  publishUserState(req.senderId, "break-request");
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(req.senderId, {
    title: "☕ دعوت استراحت تأیید شد",
    body: "هم‌شیفتی‌تان پذیرفت؛ از پنل هم‌شیفتی «من هم آماده‌ام» را بزنید.",
    tag: "break-request-accepted",
    kind: "achievement",
    url: "/dashboard",
  }).catch(() => {});
  return { ok: true, accepted: true };
}

/** Sender may withdraw their own pending invitation. */
export async function cancelBreakRequest(userId: string, requestId: string) {
  const req = await prisma.breakRequest.findUnique({ where: { id: requestId } });
  if (!req || req.senderId !== userId) throw new AppError("درخواست یافت نشد", 404);
  if (req.status !== "PENDING") throw new AppError("این درخواست قابل لغو نیست", 409);
  await prisma.breakRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  publishUserState(req.recipientId, "break-request");
  return { ok: true };
}

/**
 * Coworker picker for the invitation UI: only employees who are CURRENTLY on
 * an active shift (the authorized "same shift" set). Role and self are
 * filtered server-side, not by hiding options in the UI.
 */
export async function listSameShiftCoworkers(userId: string) {
  const me = await prisma.user.findUnique({ where: { id: userId } });
  if (me?.role !== "EMPLOYEE") return [];
  if (!(await getActiveShift(userId))) return [];
  const shifts = await prisma.shift.findMany({
    where: { status: "ACTIVE", userId: { not: userId } },
    select: { userId: true },
  });
  const ids = shifts.map((s) => s.userId);
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, role: "EMPLOYEE", status: { not: "OFFLINE" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true },
  });
  return users;
}
