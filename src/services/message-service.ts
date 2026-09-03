import { prisma } from "@/lib/db";
import { AppError } from "@/lib/utils";

export const DIRECT_MESSAGE_MAX_LENGTH = 500;

function validateMessage(message: string) {
  const value = message.trim();
  if (!value) throw new AppError("متن پیام نمی‌تواند خالی باشد", 400);
  if (value.length > DIRECT_MESSAGE_MAX_LENGTH) throw new AppError("متن پیام بیش از حد طولانی است", 400);
  return value;
}

export async function sendDirectMessage(senderId: string, recipientId: string, message: string) {
  const value = validateMessage(message);
  const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { role: true } });
  if (!sender || (sender.role !== "SUPERVISOR" && sender.role !== "ADMIN")) {
    throw new AppError("ارسال پیام فقط برای سرپرست مجاز است", 403);
  }
  const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true, role: true } });
  if (!recipient || recipient.role === "ADMIN" || recipient.role === "SUPERVISOR") {
    throw new AppError("کارمند مقصد معتبر نیست", 400);
  }
  const created = await prisma.directMessage.create({
    data: { senderId, recipientId: recipient.id, message: value },
    include: { sender: { select: { name: true } } },
  });
  const { sendPushToUser } = await import("@/lib/push");
  await sendPushToUser(recipient.id, {
    title: "پیام جدید از سرپرست",
    body: value,
    tag: `direct-message:${created.id}`,
    kind: "direct-message",
    url: "/dashboard",
  });
  return created;
}

export async function getMyDirectMessages(recipientId: string) {
  return prisma.directMessage.findMany({
    where: { recipientId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { sender: { select: { name: true, username: true } } },
  });
}

export async function markDirectMessageRead(recipientId: string, messageId: string) {
  const result = await prisma.directMessage.updateMany({
    where: { id: messageId, recipientId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  if (result.count !== 1) throw new AppError("پیام پیدا نشد", 404);
  return { ok: true };
}

export async function getEmployeeRecipients() {
  return prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, username: true },
  });
}
