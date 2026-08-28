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

export async function setMemberReady(groupId: string, userId: string, now = new Date()) {
  const member = await prisma.buddyMember.findFirst({ where: { groupId, userId } });
  if (!member) throw new AppError("عضو گروه یافت نشد", 404);
  // mark ready
  await prisma.buddyMember.update({ where: { id: member.id }, data: { ready: true, readyAt: now } as any });

  // check if all members ready
  const members = await prisma.buddyMember.findMany({ where: { groupId } });
  if (members.length === 0) throw new AppError("گروه نامعتبر است", 400);
  const allReady = members.every((m) => (m as any).ready === true);
  if (allReady) {
    // start the group break
    return startGroupBreak(groupId, now);
  }
  return { success: true, ready: true };
}

export async function setMemberUnready(groupId: string, userId: string) {
  const member = await prisma.buddyMember.findFirst({ where: { groupId, userId } });
  if (!member) throw new AppError("عضو گروه یافت نشد", 404);
  await prisma.buddyMember.update({ where: { id: member.id }, data: { ready: false, readyAt: null } as any });
  return { success: true, ready: false };
}

async function startGroupBreak(groupId: string, now: Date) {
  // Atomically set actualStart/actualEnd/status for each member's next scheduled break
  const members = await prisma.buddyMember.findMany({ where: { groupId } });
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const breakDuration = settings?.breakDurationMinutes ?? 10;
  const actualEnd = new Date(now.getTime() + breakDuration * 60_000);

  const operations: any[] = [];
  const userIds = members.map((m) => m.userId);

  for (const uid of userIds) {
    const shift = await prisma.shift.findFirst({ where: { userId: uid, status: "ACTIVE" }, include: { breaks: { orderBy: { breakIndex: "asc" } } } });
    if (!shift) throw new AppError("یکی از اعضا شیفت فعال ندارد", 400);
    const open = shift.breaks[shift.breaks.length - 1];
    if (!open || open.status !== "SCHEDULED") throw new AppError("برای یکی از اعضا استراحت برنامه‌ریزی‌شده‌ای موجود نیست", 400);
    operations.push(
      prisma.break.update({ where: { id: open.id }, data: { actualStart: now, actualEnd, status: "ACTIVE", startDelayMinutes: Math.max(0, Math.round((now.getTime()-open.scheduledStart.getTime())/60000)) } }),
    );
    operations.push(prisma.user.update({ where: { id: uid }, data: { status: "ON_BREAK" } }));
  }

  await prisma.$transaction(operations);

  // reset ready flags
  await prisma.buddyMember.updateMany({ where: { groupId }, data: { ready: false, readyAt: null } as any });

  return { success: true, actualStart: now.toISOString(), actualEnd: actualEnd.toISOString(), members: userIds };
}
