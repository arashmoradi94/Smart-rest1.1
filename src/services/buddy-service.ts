import { prisma } from "@/lib/db";
import { AppError } from "@/lib/utils";

export async function sendBuddyRequest(requesterId: string, targetId: string) {
  if (requesterId === targetId) throw new AppError("نمی‌توانید خودتان را درخواست کنید", 400);

  const existing = await prisma.buddyRequest.findFirst({
    where: {
      requesterId,
      targetId,
      status: { in: ["PENDING", "ACCEPTED"] },
    },
  });
  if (existing) throw new AppError("درخواست مشابهی در انتظار یا پذیرفته‌شده وجود دارد", 409);

  // Check buddy count limit (max 2)
  const memberCount = await prisma.buddyMember.count({ where: { userId: requesterId } });
  if (memberCount >= 2) throw new AppError("شما حداکثر 2 هم‌تیمی می‌توانید داشته باشید", 409);

  return prisma.buddyRequest.create({ data: { requesterId, targetId } });
}

export async function listIncomingRequests(userId: string) {
  return prisma.buddyRequest.findMany({ where: { targetId: userId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
}

export async function acceptBuddyRequest(requestId: string, accepterId: string) {
  const req = await prisma.buddyRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new AppError("درخواست پیدا نشد", 404);
  if (req.targetId !== accepterId) throw new AppError("دسترسی غیرمجاز", 403);
  if (req.status !== "PENDING") throw new AppError("درخواست دیگر قابل‌قبول نیست", 409);

  // Check both users buddy counts
  const requesterBuddyCount = await prisma.buddyMember.count({ where: { userId: req.requesterId } });
  const accepterBuddyCount = await prisma.buddyMember.count({ where: { userId: req.targetId } });
  if (requesterBuddyCount >= 2 || accepterBuddyCount >= 2) {
    throw new AppError("یکی از کاربران به حد بیشتر از دوستان رسیده است", 409);
  }

  // Create a group for the two users (simple flow)
  const group = await prisma.buddyGroup.create({
    data: {
      name: null,
      createdBy: accepterId,
      members: {
        create: [
          { userId: req.requesterId },
          { userId: req.targetId },
        ],
      },
    },
    include: { members: true },
  });

  await prisma.buddyRequest.update({ where: { id: requestId }, data: { status: "ACCEPTED" } });
  return group;
}

export async function cancelBuddyRequest(requestId: string, userId: string) {
  const req = await prisma.buddyRequest.findUnique({ where: { id: requestId } });
  if (!req) throw new AppError("درخواست پیدا نشد", 404);
  if (req.requesterId !== userId && req.targetId !== userId) throw new AppError("دسترسی غیرمجاز", 403);
  if (req.status !== "PENDING") throw new AppError("درخواست قابل‌لغو نیست", 409);
  return prisma.buddyRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
}

export async function removeBuddy(userId: string, removeUserId: string) {
  // Remove member relation from groups where both present; if group becomes empty or single, delete group or leave single
  const memberships = await prisma.buddyMember.findMany({ where: { userId } });
  for (const m of memberships) {
    const other = await prisma.buddyMember.findFirst({ where: { groupId: m.groupId, userId: removeUserId } });
    if (other) {
      // delete the member
      await prisma.buddyMember.deleteMany({ where: { groupId: m.groupId, userId } });
      // if group now has <=1 members, delete group and remaining members
      const remaining = await prisma.buddyMember.count({ where: { groupId: m.groupId } });
      if (remaining <= 1) {
        await prisma.buddyMember.deleteMany({ where: { groupId: m.groupId } });
        await prisma.buddyGroup.delete({ where: { id: m.groupId } });
      }
      return { success: true };
    }
  }
  throw new AppError("هم‌تیمی یافت نشد", 404);
}
