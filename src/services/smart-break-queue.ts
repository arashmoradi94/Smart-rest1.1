import { prisma } from "@/lib/db";
import { publishStates } from "@/lib/events";
import { AppError, addMinutes } from "@/lib/utils";
import { getSettings } from "@/services/settings-service";
import { getActiveShift } from "@/services/shift-service";

export type SmartBreakQueueState = "NONE" | "WAITING" | "READY" | "STARTED" | "EXPIRED" | "CANCELLED";

export type SmartBreakQueueView = {
  id: string;
  state: SmartBreakQueueState;
  position: number;
  readyUntil?: string;
  waitedMinutes: number;
  canCancel: boolean;
};

function normalizeQueueState(state: string | null | undefined): SmartBreakQueueState {
  switch (state) {
    case "WAITING":
      return "WAITING";
    case "READY":
      return "READY";
    case "STARTED":
      return "STARTED";
    case "EXPIRED":
      return "EXPIRED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "NONE";
  }
}

function queueScore(now: Date, createdAt: Date, breakCount: number): number {
  const waitingMinutes = Math.max(0, Math.round((now.getTime() - createdAt.getTime()) / 60_000));
  return waitingMinutes * 3 + Math.max(0, breakCount - 1) * 2;
}

export async function processSmartBreakQueue(now = new Date()) {
  const settings = await getSettings();
  const entries = await prisma.smartBreakQueueEntry.findMany({
    where: { state: { in: ["WAITING", "READY"] } },
    orderBy: [{ priorityScore: "asc" }, { queuedAt: "asc" }],
  });

  for (const entry of entries) {
    const shift = await getActiveShift(entry.userId).catch(() => null);
    if (!shift || shift.id !== entry.shiftId || shift.status !== "ACTIVE") {
      await prisma.smartBreakQueueEntry.updateMany({
        where: { id: entry.id, state: { in: ["WAITING", "READY"] } },
        data: { state: "CANCELLED", cancelledAt: now },
      });
      continue;
    }

    const user = await prisma.user.findUnique({
      where: { id: entry.userId },
      select: { onCall: true, status: true },
    });
    if (user?.onCall) {
      await prisma.smartBreakQueueEntry.updateMany({
        where: { id: entry.id, state: { in: ["WAITING", "READY"] } },
        data: { state: "WAITING", readyAt: null, expiresAt: null },
      });
      continue;
    }

    const breakCount = await prisma.break.count({ where: { userId: entry.userId, status: { in: ["COMPLETED", "LATE", "ACTIVE", "OVERTIME"] } } });
    const activeBreakCount = await prisma.break.count({ where: { actualStart: { not: null }, actualEnd: null } });
    const scheduledBreak = shift.breaks.find((b) => b.status === "SCHEDULED");
    const shouldUpgrade = activeBreakCount < settings.maxConcurrentBreaks && !!scheduledBreak;

    if (entry.state === "READY" && entry.expiresAt && now >= entry.expiresAt) {
      await prisma.smartBreakQueueEntry.update({
        where: { id: entry.id },
        data: { state: "EXPIRED", expiresAt: now, readyAt: entry.readyAt ?? now },
      });
      continue;
    }

    if (entry.state === "WAITING" && shouldUpgrade) {
      const ahead = await prisma.smartBreakQueueEntry.count({
        where: {
          shiftId: entry.shiftId,
          state: { in: ["WAITING", "READY"] },
          id: { not: entry.id },
          OR: [
            { priorityScore: { lt: entry.priorityScore } },
            { AND: [{ priorityScore: { equals: entry.priorityScore } }, { queuedAt: { lt: entry.queuedAt } }] },
          ],
        },
      });
      if (ahead === 0) {
        await prisma.smartBreakQueueEntry.update({
          where: { id: entry.id },
          data: {
            state: "READY",
            readyAt: now,
            expiresAt: addMinutes(now, 5),
          },
        });
        publishStates([entry.userId]);
      }
    }

    if (entry.state === "READY" && activeBreakCount >= settings.maxConcurrentBreaks) {
      const current = await prisma.smartBreakQueueEntry.findUnique({ where: { id: entry.id } });
      if (current && current.readyAt && current.expiresAt && now >= current.expiresAt) {
        await prisma.smartBreakQueueEntry.update({
          where: { id: entry.id },
          data: { state: "EXPIRED" },
        });
      }
    }

    const queueRank = queueScore(now, entry.queuedAt, breakCount);
    if (entry.priorityScore !== queueRank) {
      await prisma.smartBreakQueueEntry.update({
        where: { id: entry.id },
        data: { priorityScore: queueRank },
      });
    }
  }
}

export async function getSmartBreakQueueForUser(userId: string, now = new Date()): Promise<SmartBreakQueueView | null> {
  await processSmartBreakQueue(now);
  const shift = await getActiveShift(userId).catch(() => null);
  if (!shift) return null;
  const entry = await prisma.smartBreakQueueEntry.findFirst({
    where: { userId, shiftId: shift.id, state: { in: ["WAITING", "READY", "EXPIRED"] } },
    orderBy: { queuedAt: "desc" },
  });
  if (!entry) return null;

  const ahead = await prisma.smartBreakQueueEntry.count({
    where: {
      shiftId: shift.id,
      state: { in: ["WAITING", "READY"] },
      OR: [
        { priorityScore: { lt: entry.priorityScore } },
        { AND: [{ priorityScore: { equals: entry.priorityScore } }, { queuedAt: { lt: entry.queuedAt } }] },
      ],
    },
  });

  return {
    id: entry.id,
    state: normalizeQueueState(entry.state),
    position: ahead + 1,
    readyUntil: entry.expiresAt?.toISOString(),
    waitedMinutes: Math.max(0, Math.round((now.getTime() - entry.queuedAt.getTime()) / 60_000)),
    canCancel: entry.state === "WAITING" || entry.state === "READY",
  };
}

export async function requestSmartBreakQueue(userId: string, now = new Date()) {
  const settings = await getSettings();
  const shift = await getActiveShift(userId);
  if (!shift) throw new AppError("ابتدا شیفت خود را شروع کنید", 409);

  const running = shift.breaks.find((b) => b.status === "ACTIVE" || b.status === "OVERTIME");
  if (running) throw new AppError("شما هم‌اکنون در استراحت هستید", 409);
  const scheduled = shift.breaks.find((b) => b.status === "SCHEDULED");
  if (!scheduled) throw new AppError("استراحت برنامه‌ریزی‌شده‌ای وجود ندارد", 409);

  const activeBreakCount = await prisma.break.count({ where: { actualStart: { not: null }, actualEnd: null } });
  if (activeBreakCount < settings.maxConcurrentBreaks) {
    return { queued: false, state: "NONE" as const };
  }

  const existing = await prisma.smartBreakQueueEntry.findFirst({
    where: { userId, shiftId: shift.id, state: { in: ["WAITING", "READY"] } },
  });
  if (existing) {
    await processSmartBreakQueue(now);
    return {
      queued: true,
      state: normalizeQueueState(existing.state),
      entryId: existing.id,
      message: "شما در صف استراحت قرار گرفتید.",
    };
  }

  const breakCount = await prisma.break.count({ where: { userId, status: { in: ["COMPLETED", "LATE"] } } });
  const entry = await prisma.smartBreakQueueEntry.create({
    data: {
      userId,
      shiftId: shift.id,
      state: "WAITING",
      priorityScore: queueScore(now, now, breakCount),
      queuedAt: now,
      readyAt: null,
      expiresAt: null,
    },
  });
  publishStates([userId]);
  return {
    queued: true,
    state: "WAITING" as const,
    entryId: entry.id,
    message: "شما در صف استراحت قرار گرفتید.",
  };
}

export async function cancelSmartBreakQueue(userId: string, now = new Date()) {
  const shift = await getActiveShift(userId).catch(() => null);
  if (!shift) return { cancelled: false as const };
  const updated = await prisma.smartBreakQueueEntry.updateMany({
    where: { userId, shiftId: shift.id, state: { in: ["WAITING", "READY"] } },
    data: { state: "CANCELLED", cancelledAt: now },
  });
  if (updated.count === 0) return { cancelled: false as const };
  publishStates([userId]);
  return { cancelled: true as const };
}
