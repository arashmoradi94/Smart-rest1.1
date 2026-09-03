import { prisma } from "@/lib/db";
import { AppError, addMinutes } from "@/lib/utils";
import { publishStates, publishUserState } from "@/lib/events";
import { getSettings } from "@/services/settings-service";
import { getActiveShift } from "@/services/shift-service";

const MAX_BUDDIES = 2; // each user picks at most 2 → group max 3
const MAX_GROUP = 3;
let groupStartTail = Promise.resolve();

async function withGroupStartLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = groupStartTail;
  let release!: () => void;
  groupStartTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Normalized pair key so BuddyLink is unique regardless of direction */
function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function listBuddies(userId: string) {
  const [links, incoming, outgoing] = await Promise.all([
    prisma.buddyLink.findMany({
      where: { OR: [{ aId: userId }, { bId: userId }] },
    }),
    prisma.buddyRequest.findMany({
      where: { addresseeId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.buddyRequest.findMany({
      where: { requesterId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const buddyIds = links.flatMap((l) => [l.aId, l.bId]).filter((id) => id !== userId);
  const allIds = [
    ...buddyIds,
    ...incoming.map((r) => r.requesterId),
    ...outgoing.map((r) => r.addresseeId),
  ];
  const users = await prisma.user.findMany({
    where: { id: { in: allIds.length ? allIds : ["-"] } },
    select: { id: true, name: true, username: true, status: true, onCall: true },
  });
  const nameOf = Object.fromEntries(users.map((u) => [u.id, u]));

  return {
    buddies: buddyIds.map((id) => ({
      id,
      name: nameOf[id]?.name ?? id,
      status: nameOf[id]?.status ?? "OFFLINE",
      onCall: nameOf[id]?.onCall ?? false,
    })),
    incomingRequests: incoming.map((r) => ({
      id: r.id,
      from: nameOf[r.requesterId]?.name ?? r.requesterId,
    })),
    outgoingRequests: outgoing.map((r) => ({
      id: r.id,
      to: nameOf[r.addresseeId]?.name ?? r.addresseeId,
    })),
    maxBuddies: MAX_BUDDIES,
  };
}

export async function sendBuddyRequest(requesterId: string, addresseeId: string) {
  if (requesterId === addresseeId) throw new AppError("نمی‌توانید خودتان را انتخاب کنید", 400);
  const [, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: requesterId } }),
    prisma.user.findUnique({ where: { id: addresseeId } }),
  ]);
  if (!target) throw new AppError("کاربر مورد نظر یافت نشد", 404);
  if (target.role !== "EMPLOYEE") throw new AppError("فقط کارکنان می‌توانند هم‌شیفت شوند", 400);

  const [myLinks, theirLinks] = await Promise.all([
    prisma.buddyLink.count({ where: { OR: [{ aId: requesterId }, { bId: requesterId }] } }),
    prisma.buddyLink.count({ where: { OR: [{ aId: addresseeId }, { bId: addresseeId }] } }),
  ]);
  if (myLinks >= MAX_BUDDIES) throw new AppError("حداکثر ۲ هم‌شیفتی می‌توانید داشته باشید", 409);
  if (theirLinks + 1 > MAX_BUDDIES) throw new AppError("ظرفیت هم‌شیفتی طرف مقابل تکمیل است", 409);

  const already = await prisma.buddyLink.findFirst({
    where: { OR: [{ aId: requesterId, bId: addresseeId }, { aId: addresseeId, bId: requesterId }] },
  });
  if (already) throw new AppError("شما از قبل هم‌شیفت هستید", 409);

  const pending = await prisma.buddyRequest.findMany({
    where: { status: "PENDING", OR: [{ requesterId, addresseeId }, { requesterId: addresseeId, addresseeId: requesterId }] },
  });
  if (pending.length) throw new AppError("درخواست قبلاً ارسال شده و در انتظار پاسخ است", 409);

  await prisma.buddyRequest.create({ data: { requesterId, addresseeId } });
  const { logAudit } = await import("@/lib/audit");
  await logAudit(requesterId, "BUDDY_REQUEST", `to:${addresseeId}`);
  publishUserState(addresseeId, "buddy-request");
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(addresseeId, {
    title: "🤝 درخواست هم‌شیفتی",
    body: "درخواست هم‌شیفتی جدید دارید.",
    tag: "buddy-request",
    kind: "announcement",
    url: "/dashboard",
  }).catch(() => {});
  return { ok: true };
}

export async function respondBuddyRequest(userId: string, requestId: string, accept: boolean) {
  const req = await prisma.buddyRequest.findUnique({ where: { id: requestId } });
  if (!req || req.addresseeId !== userId) throw new AppError("درخواست یافت نشد", 404);
  if (req.status !== "PENDING") throw new AppError("این درخواست قبلاً پاسخ داده شده", 409);

  if (!accept) {
    await prisma.buddyRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", respondedAt: new Date() },
    });
    const { logAudit } = await import("@/lib/audit");
    await logAudit(userId, "BUDDY_RESPONSE", `rejected request:${requestId}`);
    return { ok: true, linked: false };
  }

  // Re-check capacity at accept time inside the transaction to close the race
  // where both parties accepted other requests simultaneously.
  await prisma.$transaction(async (tx) => {
    const myLinks = await tx.buddyLink.count({
      where: { OR: [{ aId: userId }, { bId: userId }] },
    });
    if (myLinks >= MAX_BUDDIES) throw new AppError("حداکثر ۲ هم‌شیفتی می‌توانید داشته باشید", 409);
    const [aId, bId] = pairKey(req.requesterId, req.addresseeId);
    await tx.buddyRequest.update({
      where: { id: requestId },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
    await tx.buddyLink.create({ data: { aId, bId } }).catch(() => {
      throw new AppError("این هم‌شیفتی از قبل وجود دارد", 409);
    });
  });
  publishStates([req.requesterId, userId]);
  const { logAudit } = await import("@/lib/audit");
  await logAudit(userId, "BUDDY_RESPONSE", `accepted request:${requestId}`);
  const { sendPushToUser } = await import("@/lib/push");
  sendPushToUser(req.requesterId, {
    title: "🤝 هم‌شیفتی تأیید شد",
    body: "درخواست هم‌شیفتی شما تأیید شد.",
    tag: "buddy-accept",
    kind: "achievement",
    url: "/dashboard",
  }).catch(() => {});
  return { ok: true, linked: true };
}

export async function cancelBuddyRequest(userId: string, requestId: string) {
  const req = await prisma.buddyRequest.findUnique({ where: { id: requestId } });
  if (!req || req.requesterId !== userId) throw new AppError("درخواست یافت نشد", 404);
  if (req.status !== "PENDING") throw new AppError("این درخواست قابل لغو نیست", 409);
  await prisma.buddyRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  return { ok: true };
}

export async function removeBuddy(userId: string, buddyId: string) {
  const [aId, bId] = pairKey(userId, buddyId);
  const link = await prisma.buddyLink.findUnique({
    where: { aId_bId: { aId, bId } },
  });
  if (!link) throw new AppError("این هم‌شیفتی وجود ندارد", 404);
  await prisma.buddyLink.delete({ where: { id: link.id } });
  const { logAudit } = await import("@/lib/audit");
  await logAudit(userId, "BUDDY_REMOVE", `removed:${buddyId}`);
  publishStates([userId, buddyId]);
  return { ok: true };
}

/** Admin/supervisor: force link/unlink two users */
export async function adminSetBuddy(adminId: string, userId: string, buddyId: string, link: boolean) {
  if (userId === buddyId) throw new AppError("پارامتر نامعتبر", 400);
  const [aId, bId] = pairKey(userId, buddyId);
  const { logAudit } = await import("@/lib/audit");
  if (link) {
    const countA = await prisma.buddyLink.count({ where: { OR: [{ aId: userId }, { bId: userId }] } });
    const countB = await prisma.buddyLink.count({ where: { OR: [{ aId: buddyId }, { bId: buddyId }] } });
    if (countA >= MAX_BUDDIES || countB >= MAX_BUDDIES) {
      throw new AppError("ظرفیت هم‌شیفتی یکی از کاربران تکمیل است", 409);
    }
    await prisma.buddyLink.upsert({
      where: { aId_bId: { aId, bId } },
      create: { aId, bId },
      update: {},
    });
    await logAudit(adminId, "ADMIN_SYNC_BUDDY", `${userId}+${buddyId}`);
  } else {
    await prisma.buddyLink.deleteMany({ where: { aId, bId } });
    await logAudit(adminId, "ADMIN_UNSYNC_BUDDY", `${userId}+${buddyId}`);
  }
  return { ok: true };
}

/**
 * Break-ready for a buddy group.
 *
 * Roster is FIXED when the group is created: creator + their confirmed buddies
 * (max 3). Every member presses Ready; the shared break starts only when every
 * on-shift member is ready AND the whole group fits within the concurrent
 * break capacity — one shared server timestamp, full duration for everyone.
 * A member who is on a call just keeps the others waiting; nobody's break is
 * lost. Members without an active shift are dropped from the expectation.
 */
export async function readyForGroupBreak(userId: string, now = new Date()) {
  const settings = await getSettings();
  if (!settings.groupBreakEnabled) {
    throw new AppError("استراحت گروهی در حال حاضر توسط مدیر غیرفعال شده است", 409);
  }
  const shift = await getActiveShift(userId);
  if (!shift) throw new AppError("ابتدا شیفت خود را شروع کنید", 409);
  const requester = await prisma.user.findUnique({
    where: { id: userId },
    select: { onCall: true, status: true },
  });
  if (requester?.onCall || requester?.status === "ON_CALL") {
    throw new AppError("هنگام تماس امکان شروع استراحت گروهی ندارید", 409);
  }

  const myRunning = shift.breaks.find((b) => b.status === "ACTIVE" || b.status === "OVERTIME");
  if (myRunning) throw new AppError("شما هم‌اکنون در استراحت هستید", 409);
  const scheduled = shift.breaks.find((b) => b.status === "SCHEDULED");
  if (!scheduled) throw new AppError("استراحت برنامه‌ریزی‌شده‌ای وجود ندارد", 409);

  const links = await prisma.buddyLink.findMany({
    where: { OR: [{ aId: userId }, { bId: userId }] },
  });
  const buddyIds = [...new Set(links.flatMap((l) => [l.aId, l.bId]).filter((id) => id !== userId))];

  // Roster is fixed at creation; joining someone else's open group is allowed
  // only if they are a direct buddy and the group is not full.
  let group = await prisma.groupBreak.findFirst({
    where: { status: { in: ["FORMING", "DELAYED"] }, members: { some: { userId } } },
    include: { members: true },
  });
  if (!group) {
    const buddyGroup = buddyIds.length
      ? await prisma.groupBreak.findFirst({
          where: { status: { in: ["FORMING", "DELAYED"] }, members: { some: { userId: { in: buddyIds } } } },
          include: { members: true },
        })
      : null;
    if (buddyGroup) {
      if (buddyGroup.members.length >= MAX_GROUP) {
        throw new AppError("ظرفیت گروه هم‌شیفتی تکمیل است", 409);
      }
      group = buddyGroup;
      await prisma.groupBreakMember.create({
        data: { groupBreakId: group.id, userId },
      }).catch(() => {});
    } else {
      group = await prisma.groupBreak.create({
        data: { status: "FORMING", createdById: userId, members: { create: { userId } } },
        include: { members: true },
      });
    }
    await prisma.break.updateMany({
      where: { id: scheduled.id, status: "SCHEDULED" },
      data: { groupBreakId: group.id },
    });
  }

  await prisma.groupBreakMember.upsert({
    where: { groupBreakId_userId: { groupBreakId: group.id, userId } },
    create: { groupBreakId: group.id, userId, readyAt: now },
    update: { readyAt: now },
  });

  // Roster = current members ∪ (creator + creator's confirmed buddies).
  // Anchoring on the creator makes the roster stable while others join.
  const [members, creatorLinks] = await Promise.all([
    prisma.groupBreakMember.findMany({ where: { groupBreakId: group.id } }),
    prisma.buddyLink.findMany({
      where: { OR: [{ aId: group.createdById }, { bId: group.createdById }] },
    }),
  ]);
  const memberIds = members.map((m) => m.userId);
  const rosterIds = [
    ...new Set([...memberIds, group.createdById, ...creatorLinks.flatMap((l) => [l.aId, l.bId])]),
  ];
  const users = await prisma.user.findMany({
    where: { id: { in: rosterIds } },
    select: { id: true, name: true, onCall: true, status: true },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const onShiftIds: string[] = [];
  for (const uid of rosterIds) {
    const s = await getActiveShift(uid).catch(() => null);
    if (s) onShiftIds.push(uid);
  }
  const readyIds = members.filter((m) => m.readyAt && onShiftIds.includes(m.userId)).map((m) => m.userId);
  const expected = rosterIds.sort();
  const readyCount = readyIds.length;
  const totalCount = expected.length;
  const unavailableIds = expected.filter(
    (id) =>
      !onShiftIds.includes(id) ||
      userMap[id]?.onCall ||
      userMap[id]?.status === "OFFLINE" ||
      userMap[id]?.status === "ON_CALL",
  );
  const onCallBlocker = expected.some(
    (id) => userMap[id]?.onCall || userMap[id]?.status === "ON_CALL",
  );

  // A group needs at least one OTHER on-shift member; otherwise start solo.
  if (totalCount <= 1) {
    await prisma.$transaction([
      prisma.break.updateMany({
        where: { groupBreakId: group.id, status: "SCHEDULED" },
        data: { groupBreakId: null },
      }),
      prisma.groupBreak.update({
        where: { id: group.id },
        data: { status: "CANCELLED" },
      }),
    ]).catch(() => {});
    throw new AppError("هم‌شیفتی آنلاینی برای استراحت گروهی وجود ندارد", 409);
  }

  // Everyone ready AND nobody on a call → start. A member inside a call keeps
  // the whole group waiting; their break is never lost.
  const everyoneReady =
    totalCount > 1 &&
    unavailableIds.length === 0 &&
    expected.every((id) => readyIds.includes(id)) &&
    !onCallBlocker;

  if (!everyoneReady) {
    if (unavailableIds.length > 0 && group.status !== "DELAYED") {
      await prisma.groupBreak.update({
        where: { id: group.id },
        data: { status: "DELAYED" },
      });
    }
    return {
      groupBreakId: group.id,
      started: false,
      readyCount,
      totalCount,
      waitingOnCall: onCallBlocker,
      waitingUnavailable: unavailableIds.length > 0,
      message: onCallBlocker
        ? "یکی از اعضا در تماس است؛ منتظر می‌مانیم…"
        : unavailableIds.length > 0
          ? "یکی از اعضای گروه آفلاین یا فاقد شیفت فعال است؛ پس از آماده‌شدن او دوباره تلاش کنید…"
          : "منتظر آماده‌شدن هم‌تیمی هستیم…",
    };
  }

  // Everyone ready → start as ONE group if the full group fits in capacity
  // AND stays within the team load-ratio guard. Nothing is rescheduled on a
  // block: members keep their own normal break queue and may start solo.
  const startedAt = now;
  const results = await withGroupStartLock(() => prisma.$transaction(async (tx) => {
    const activeCount = await tx.break.count({
      where: { actualStart: { not: null }, actualEnd: null },
    });
    if (activeCount + totalCount > settings.maxConcurrentBreaks) {
      return { blocked: "capacity" as const, started: [] as string[], onlineAgents: 0 };
    }
    const onlineAgents = await tx.shift.count({ where: { status: "ACTIVE" } });
    const loadRatio = onlineAgents > 0 ? (activeCount + totalCount) / onlineAgents : 0;
    if (loadRatio > settings.maxGroupBreakLoadRatio) {
      return { blocked: "load" as const, started: [] as string[], onlineAgents };
    }
    const started: string[] = [];
    for (const uid of expected) {
      const uShift = await tx.shift.findFirst({
        where: { userId: uid, status: "ACTIVE" },
        include: { breaks: { orderBy: { breakIndex: "asc" } } },
      });
      const open = uShift?.breaks[uShift.breaks.length - 1];
      if (!open || open.status !== "SCHEDULED") continue;
      const res = await tx.break.updateMany({
        where: { id: open.id, status: "SCHEDULED", actualStart: null, actualEnd: null },
        data: {
          actualStart: startedAt,
          status: "ACTIVE",
          groupBreakId: group.id,
          startDelayMinutes: Math.max(0, Math.round((startedAt.getTime() - open.scheduledStart.getTime()) / 60_000)),
        },
      });
      if (res.count === 1) {
        await tx.user.update({ where: { id: uid }, data: { status: "ON_BREAK" } });
        started.push(uid);
      }
    }
    if (started.length !== expected.length) {
      throw new AppError("استراحت گروهی دیگر قابل شروع نیست؛ لطفاً دوباره تلاش کنید", 409);
    }
    await tx.groupBreak.update({
      where: { id: group.id },
      data: { status: "ACTIVE", startedAt },
    });
    return { blocked: null as null, started, onlineAgents };
  }));

  if (results.blocked) {
    await prisma.groupBreak.update({
      where: { id: group.id },
      data: { status: "DELAYED" },
    });
    // Display-only suggestion: reuse the SAME queue primitives as the normal
    // scheduler (countConcurrentBreaks scan) so the proposal never contradicts
    // the regular break queue. Running breaks occupy their slot until the
    // server-guaranteed fixed end; scheduled breaks model future demand.
    const { findGroupSlot } = await import("@/services/smart-break-service");
    const [scheduled, running] = await Promise.all([
      prisma.break.findMany({
        where: {
          userId: { notIn: expected },
          status: "SCHEDULED",
          scheduledEnd: { gt: now },
          shift: { status: "ACTIVE" },
        },
        select: { userId: true, scheduledStart: true, scheduledEnd: true },
      }),
      prisma.break.findMany({
        where: { userId: { notIn: expected }, actualStart: { not: null }, actualEnd: null },
        select: { userId: true, actualStart: true, extendMinutes: true },
      }),
    ]);
    const others = [
      ...scheduled,
      ...running.map((r) => ({
        userId: r.userId,
        scheduledStart: now,
        scheduledEnd: addMinutes(r.actualStart!, settings.breakDurationMinutes + r.extendMinutes),
      })),
    ];
    const slot = findGroupSlot({
      groupSize: totalCount,
      onlineAgents: results.onlineAgents,
      settings,
      othersScheduled: others,
      from: now,
    });
    const { sendPushToUser } = await import("@/lib/push");
    for (const uid of expected) {
      sendPushToUser(uid, {
        title: "⏳ استراحت گروهی به تعویق افتاد",
        body: "ظرفیت فعلی کافی نیست؛ استراحت عادی شما بدون تغییر باقی می‌ماند.",
        tag: `group-break-delayed:${group.id}`,
        kind: "reminder",
        url: "/dashboard",
      }).catch(() => {});
    }
    return {
      groupBreakId: group.id,
      started: false,
      readyCount,
      totalCount,
      waitingCapacity: results.blocked === "capacity",
      waitingLoad: results.blocked === "load",
      ...(slot
        ? { suggestedStart: slot.scheduledStart.toISOString(), suggestedEnd: slot.scheduledEnd.toISOString() }
        : {}),
      message:
        results.blocked === "capacity"
          ? "همه آماده‌اند؛ منتظر ظرفیت استراحت هستیم…"
          : "سطح تیم اجازه استراحت گروهی همین حالا نمی‌دهد؛ می‌توانید استراحت عادی خود را شروع کنید.",
    };
  }

  const { sendPushToUser } = await import("@/lib/push");
  for (const uid of results.started) {
    sendPushToUser(uid, {
      title: "☕ استراحت گروهی شروع شد",
      body: "همه اعضا آماده بودند؛ وقت خوبی باشه!",
      tag: "group-break",
      kind: "break-start",
      url: "/dashboard",
    }).catch(() => {});
    const { awardCoins, COIN_RULES } = await import("@/services/gamification-service");
    await awardCoins(uid, COIN_RULES.GROUP_BREAK, `GROUP_BREAK:${group.id}:${uid}`).catch(() => {});
  }
  publishStates(results.started);

  return {
    groupBreakId: group.id,
    started: results.started.length > 0,
    startedAt: startedAt.toISOString(),
    endsAt: addMinutes(startedAt, settings.breakDurationMinutes).toISOString(),
    members: results.started,
  };
}

/** Poll group status while waiting or during the shared break */
export async function getGroupBreakStatus(userId: string) {
  const group = await prisma.groupBreak.findFirst({
    where: { status: { in: ["FORMING", "DELAYED", "ACTIVE"] }, members: { some: { userId } } },
    include: { members: true },
  });
  if (!group) return null;
  const users = await prisma.user.findMany({
    where: { id: { in: group.members.map((m) => m.userId) } },
    select: { id: true, name: true, onCall: true, status: true },
  });
  const nameOf = Object.fromEntries(users.map((u) => [u.id, u]));
  const settings = await getSettings();
  const endsAt =
    group.status === "ACTIVE" && group.startedAt
      ? addMinutes(group.startedAt, settings.breakDurationMinutes).toISOString()
      : undefined;
  const members = group.members.map((m) => ({
    userId: m.userId,
    name: nameOf[m.userId]?.name ?? m.userId,
    ready: !!m.readyAt,
    onCall: nameOf[m.userId]?.onCall ?? false,
  }));
  return {
    groupBreakId: group.id,
    status: group.status as "FORMING" | "DELAYED" | "ACTIVE",
    endsAt,
    members,
    readyCount: members.filter((m) => m.ready).length,
    totalCount: members.length,
  };
}

/**
 * Break Matching: on-shift coworkers whose scheduled break starts within the
 * suggest window. SUGGESTION ONLY — the caller renders an offer the employee
 * may ignore; no state changes, no pressure, no rescheduling.
 */
export async function getBreakMatches(userId: string, now = new Date()) {
  const settings = await getSettings();
  if (!settings.groupBreakEnabled) return { enabled: false as const, windowMinutes: 0, matches: [] };

  const [requester, links, scheduled] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { status: true, onCall: true } }),
    prisma.buddyLink.findMany({ where: { OR: [{ aId: userId }, { bId: userId }] } }),
    prisma.break.findMany({
      where: {
        userId: { not: userId },
        status: "SCHEDULED",
        actualStart: null,
        scheduledStart: { gte: now, lte: new Date(now.getTime() + settings.groupSuggestWindowMinutes * 60_000) },
        shift: { status: "ACTIVE" },
      },
      orderBy: { scheduledStart: "asc" },
      include: { user: { select: { id: true, name: true, onCall: true, status: true } } },
    }),
  ]);
  if (!requester || requester.onCall || requester.status === "ON_CALL" || requester.status === "OFFLINE") {
    return { enabled: true as const, windowMinutes: settings.groupSuggestWindowMinutes, matches: [] };
  }
  const buddyIds = new Set(links.flatMap((l) => [l.aId, l.bId]));

  const { rankBreakMatches } = await import("@/services/smart-break-service");
  const matches = rankBreakMatches(
    scheduled.map((b) => ({
      userId: b.userId,
      name: b.user.name,
      isBuddy: buddyIds.has(b.userId),
      onCall: b.user.onCall,
      ready: b.user.status === "WORKING",
      online: true,
      shiftCompatible: true,
      nextBreak: { scheduledStart: b.scheduledStart, scheduledEnd: b.scheduledEnd },
    })),
    now,
    settings.groupSuggestWindowMinutes,
  );
  return { enabled: true as const, windowMinutes: settings.groupSuggestWindowMinutes, matches };
}

/** Supervisor monitor: forming/active group breaks + live team capacity. */
export async function getGroupBreakMonitor() {
  const settings = await getSettings();
  const [groups, activeBreaks, onlineAgents] = await Promise.all([
    prisma.groupBreak.findMany({
      where: { status: { in: ["FORMING", "DELAYED", "ACTIVE", "COMPLETED"] } },
      orderBy: { createdAt: "desc" },
      include: { members: true },
    }),
    prisma.break.count({ where: { actualStart: { not: null }, actualEnd: null } }),
    prisma.shift.count({ where: { status: "ACTIVE" } }),
  ]);
  const groupBreaks = await prisma.break.findMany({
    where: { groupBreakId: { in: groups.map((g) => g.id) } },
    select: { groupBreakId: true, actualStart: true, actualEnd: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: groups.flatMap((g) => g.members.map((m) => m.userId)) } },
    select: { id: true, name: true, onCall: true },
  });
  const userOf = Object.fromEntries(users.map((u) => [u.id, u]));

  return {
    enabled: settings.groupBreakEnabled,
    capacity: {
      maxConcurrentBreaks: settings.maxConcurrentBreaks,
      activeBreaks,
      remaining: Math.max(0, settings.maxConcurrentBreaks - activeBreaks),
      onlineAgents,
      loadRatio: onlineAgents > 0 ? Math.round((activeBreaks / onlineAgents) * 100) : 0,
      maxLoadRatioPercent: Math.round(settings.maxGroupBreakLoadRatio * 100),
    },
    groups: groups.map((g) => {
      const readyCount = g.members.filter((m) => m.readyAt).length;
      const anyOnCall = g.members.some((m) => userOf[m.userId]?.onCall);
      const status =
        g.status === "ACTIVE"
          ? ("ACTIVE" as const)
          : g.status === "DELAYED"
            ? ("DELAYED" as const)
            : g.status === "COMPLETED"
              ? ("COMPLETED" as const)
            : anyOnCall
            ? ("WAITING_CALL" as const)
            : readyCount === g.members.length
              ? ("READY" as const)
              : ("WAITING" as const);
      return {
        id: g.id,
        status,
        startedAt: g.startedAt?.toISOString(),
        endsAt:
          g.status === "ACTIVE" && g.startedAt
            ? addMinutes(g.startedAt, settings.breakDurationMinutes).toISOString()
            : undefined,
        creatorId: g.createdById,
        requestedAt: g.createdAt.toISOString(),
        durationMinutes:
          g.status === "COMPLETED"
            ? Math.max(
                0,
                Math.round(
                  (Math.max(
                    ...groupBreaks
                      .filter((b) => b.groupBreakId === g.id && b.actualStart && b.actualEnd)
                      .map((b) => b.actualEnd!.getTime()),
                    g.startedAt?.getTime() ?? g.createdAt.getTime(),
                  ) -
                    (g.startedAt?.getTime() ?? g.createdAt.getTime())) /
                    60_000,
                ),
              )
            : undefined,
        capacityStatus: g.status === "DELAYED" ? "DELAYED" : g.status === "FORMING" ? "PENDING" : "APPROVED",
        members: g.members.map((m) => ({
          userId: m.userId,
          name: userOf[m.userId]?.name ?? m.userId,
          ready: !!m.readyAt,
          onCall: userOf[m.userId]?.onCall ?? false,
        })),
        readyCount,
        totalCount: g.members.length,
      };
    }),
  };
}
