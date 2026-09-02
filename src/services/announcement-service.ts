import { prisma } from "@/lib/db";
import { AppError } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { publishAll } from "@/lib/events";

/**
 * Announcements stored in a dedicated model with read/unread tracking.
 * audience: ALL | USER (targetUserIds = JSON array of user ids).
 */
export async function createAnnouncement(
  adminId: string,
  message: string,
  targetUserIds: string[] = [],
) {
  const text = message.trim().slice(0, 500);
  if (!text) throw new AppError("متن اطلاعیه الزامی است");
  let audience = "ALL";
  let targets: string[] = [];
  if (targetUserIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: targetUserIds }, role: { not: "ADMIN" } },
      select: { id: true },
    });
    targets = users.map((u) => u.id);
    if (targets.length === 0) throw new AppError("کاربر هدفی یافت نشد", 404);
    audience = "USER";
  }
  const row = await prisma.announcement.create({
    data: { authorId: adminId, message: text, audience, targetUserIds: JSON.stringify(targets) },
  });
  await logAudit(adminId, "ANNOUNCEMENT", `${audience === "ALL" ? "ALL" : targets.join(",")}: ${text}`);
  publishAll("announcement");
  const { sendPushToUser } = await import("@/lib/push");
  const recipients =
    audience === "ALL"
      ? (await prisma.user.findMany({ where: { role: { not: "ADMIN" } }, select: { id: true } })).map((u) => u.id)
      : targets;
  await Promise.all(
    recipients.map((uid) =>
      sendPushToUser(uid, {
        title: "📢 اطلاعیه",
        body: text,
        tag: `announcement:${row.id}`,
        kind: "announcement",
        url: "/dashboard",
      }).catch(() => {}),
    ),
  );
  return { ok: true, id: row.id };
}

/** Latest announcement visible to the user + whether it's unread. */
export async function getLatestForUser(userId: string) {
  const rows = await prisma.announcement.findMany({
    where: {
      OR: [{ audience: "ALL" }, { targetUserIds: { contains: userId } }],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const targetFilter = (targets: string) => {
    try {
      const arr = JSON.parse(targets) as string[];
      return arr.length === 0 || arr.includes(userId);
    } catch {
      return true;
    }
  };
  const visible = rows.filter((r) => r.audience === "ALL" || targetFilter(r.targetUserIds));
  if (visible.length === 0) return { message: "", at: null as string | null, unread: false };
  const latest = visible[0];
  const read = await prisma.announcementRead.findUnique({
    where: { announcementId_userId: { announcementId: latest.id, userId } },
  });
  return {
    id: latest.id,
    message: latest.message,
    at: latest.createdAt.toISOString(),
    unread: !read,
  };
}

export async function markRead(userId: string, announcementId: string) {
  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId, userId } },
    create: { announcementId, userId },
    update: {},
  });
  return { ok: true };
}

/** Admin list with read counts. */
export async function listForAdmin() {
  const rows = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { reads: { select: { userId: true } } },
  });
  const employees = await prisma.user.count({ where: { role: { not: "ADMIN" } } });
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    audience: r.audience,
    createdAt: r.createdAt.toISOString(),
    readCount: r.reads.length,
    totalRecipients: r.audience === "ALL" ? employees : JSON.parse(r.targetUserIds || "[]").length,
  }));
}
