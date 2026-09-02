import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { addMinutes, diffSeconds, formatPersianNumber, formatPersianTime } from "@/lib/utils";
import { companyDayKey } from "@/lib/time";
import { getSettings } from "@/services/settings-service";
import { autoAdvance, buildShiftReport, ensureNextBreak, getActiveShift } from "@/services/shift-service";
import { getGroupBreakStatus } from "@/services/buddy-service";
import type { BreakHistoryItem, EmployeeDashboardState, TimelineEvent } from "@/types";

type BreakRow = { status: string; durationMinutes: number | null; endDelayMinutes: number };
type ShiftRow = Prisma.ShiftGetPayload<{ include: { breaks: true } }>;

function buildStats(breaks: BreakRow[], breakDurationMinutes: number) {
  const done = breaks.filter((b) => b.status === "COMPLETED" || b.status === "LATE");
  const late = done.filter((b) => b.endDelayMinutes > 0).length;
  return {
    breakCount: done.length,
    totalBreakMinutes: done.reduce((s, b) => s + (b.durationMinutes ?? 0), 0),
    allowedBreakMinutes: done.length * breakDurationMinutes,
    totalDelayMinutes: done.reduce((s, b) => s + b.endDelayMinutes, 0),
    completedBreaks: done.length - late,
    lateBreaks: late,
  };
}

/** Company-timezone bucketed totals (today / this week / this month). */
function bucketStats(
  breaks: Array<{ status: string; durationMinutes: number | null; actualStart: Date | null }>,
  timezone: string,
  now: Date,
) {
  const done = breaks.filter((b) => b.status === "COMPLETED" || b.status === "LATE");
  const nowKey = companyDayKey(now, timezone);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const sum = (arr: typeof done) => arr.reduce((s, b) => s + (b.durationMinutes ?? 0), 0);
  const today = done.filter((b) => b.actualStart && companyDayKey(b.actualStart, timezone) === nowKey);
  const week = done.filter((b) => b.actualStart && b.actualStart >= weekAgo);
  const month = done.filter((b) => b.actualStart && b.actualStart >= monthAgo);
  return {
    todayBreakMinutes: sum(today),
    weekBreakMinutes: sum(week),
    monthBreakMinutes: sum(month),
    todayBreakCount: today.length,
    weekBreakCount: week.length,
    monthBreakCount: month.length,
  };
}

function buildHistory(
  breaks: Prisma.BreakGetPayload<object>[],
): BreakHistoryItem[] {
  return [...breaks]
    .sort((a, b) => b.breakIndex - a.breakIndex)
    .map((b) => ({
      id: b.id,
      breakIndex: b.breakIndex,
      scheduledStart: b.scheduledStart.toISOString(),
      scheduledEnd: b.scheduledEnd.toISOString(),
      actualStart: b.actualStart?.toISOString(),
      actualEnd: b.actualEnd?.toISOString(),
      durationMinutes: b.durationMinutes ?? undefined,
      startDelayMinutes: b.startDelayMinutes,
      endDelayMinutes: b.endDelayMinutes,
      status: (b.status === "SKIPPED" ? "CANCELLED" : b.status) as BreakHistoryItem["status"],
      group: !!b.groupBreakId,
    }));
}

function buildTimeline(shift: ShiftRow, timeZone?: string): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { time: formatPersianTime(shift.startedAt, timeZone), label: "شروع شیفت", icon: "🚀", type: "shift_start" },
  ];
  for (const b of shift.breaks) {
    if (b.actualStart) {
      events.push({
        time: formatPersianTime(b.actualStart, timeZone),
        label: `شروع استراحت ${formatPersianNumber(b.breakIndex + 1)}${b.groupBreakId ? " (گروهی)" : ""}`,
        icon: "☕",
        type: "break",
      });
    } else if (b.status === "CANCELLED" || b.status === "SKIPPED") {
      events.push({
        time: formatPersianTime(b.scheduledStart, timeZone),
        label: `استراحت ${formatPersianNumber(b.breakIndex + 1)} انجام نشد`,
        icon: "🚫",
        type: "break",
      });
    }
    if (b.actualEnd) {
      events.push({
        time: formatPersianTime(b.actualEnd, timeZone),
        label: "بازگشت به کار",
        icon: "💼",
        type: "return",
      });
    }
  }
  if (shift.endedAt) {
    events.push({
      time: formatPersianTime(shift.endedAt, timeZone),
      label: "پایان شیفت",
      icon: "🏁",
      type: "shift_end",
    });
  }
  return events;
}

export async function getEmployeeState(
  userId: string,
  now = new Date(),
): Promise<EmployeeDashboardState> {
  const settings = await getSettings();
  const serverTime = now.toISOString();

  let shift = await getActiveShift(userId);
  if (!shift) {
    const [last, user] = await Promise.all([
      prisma.shift.findFirst({
        where: { userId, status: "ENDED" },
        orderBy: { endedAt: "desc" },
        include: { breaks: { orderBy: { breakIndex: "asc" } } },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { onCall: true } }),
    ]);
    if (last?.endedAt) {
      return {
        hasActiveShift: false,
        shiftEnded: true,
        userStatus: "OFFLINE",
        onCall: user?.onCall ?? false,
        focusMode: "OFF",
        serverTime,
        shiftStartedAt: last.startedAt.toISOString(),
        shiftEndedAt: last.endedAt.toISOString(),
        timerLabel: "شیفت شما به پایان رسید",
        timerSeconds: 0,
        stats: {
          ...buildStats(last.breaks, settings.breakDurationMinutes),
          ...bucketStats(last.breaks, settings.timezone, now),
        },
        timeline: buildTimeline(last, settings.timezone),
        history: buildHistory(last.breaks),
        report: buildShiftReport(last, settings.breakDurationMinutes, last.endedAt),
        settings,
      };
    }
    return {
      hasActiveShift: false,
      shiftEnded: false,
      userStatus: "OFFLINE",
      onCall: user?.onCall ?? false,
      focusMode: "OFF",
      serverTime,
      timerLabel: "برای شروع، دکمه «شروع شیفت» را بزنید",
      timerSeconds: 0,
      stats: {
        ...buildStats([], settings.breakDurationMinutes),
        ...bucketStats([], settings.timezone, now),
      },
      timeline: [],
      history: [],
      settings,
    };
  }

  await autoAdvance(shift, now);
  await ensureNextBreak(shift, settings, now);
  shift = (await getActiveShift(userId))!;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { onCall: true } });
  const onCall = user?.onCall ?? false;
  const open = shift.breaks[shift.breaks.length - 1];
  const base = {
    hasActiveShift: true,
    shiftEnded: false,
    onCall,
    serverTime,
    shiftStartedAt: shift.startedAt.toISOString(),
    stats: {
      ...buildStats(shift.breaks, settings.breakDurationMinutes),
      ...bucketStats(shift.breaks, settings.timezone, now),
    },
    timeline: buildTimeline(shift, settings.timezone),
    history: buildHistory(shift.breaks),
    settings,
  };

  if (open && (open.status === "ACTIVE" || open.status === "OVERTIME") && open.actualStart) {
    // Full duration from actualStart (+ admin extension) — scheduledEnd is only a suggestion
    const endsAt = addMinutes(open.actualStart, settings.breakDurationMinutes + open.extendMinutes);
    const overtime = now > endsAt;
    return {
      ...base,
      userStatus: overtime ? "LATE" : "ON_BREAK",
      focusMode: "BREAK",
      currentBreak: {
        id: open.id,
        scheduledStart: open.scheduledStart.toISOString(),
        scheduledEnd: open.scheduledEnd.toISOString(),
        actualStart: open.actualStart.toISOString(),
        endsAt: endsAt.toISOString(),
        status: overtime ? "OVERTIME" : "ACTIVE",
        group: !!open.groupBreakId,
      },
      timerLabel: overtime ? "تأخیر بازگشت به کار" : "زمان باقی‌مانده استراحت",
      timerSeconds: overtime ? diffSeconds(now, endsAt) : diffSeconds(endsAt, now),
    };
  }

  const next = open?.status === "SCHEDULED" ? open : undefined;
  const group = await getGroupBreakStatus(userId);
  const waitingBuddy = group?.status === "FORMING" && !!group.members.find((m) => m.userId === userId && m.ready);
  // Break Buddy matching — a quiet, ignorable suggestion list; never blocks
  // or moves the employee's own scheduled break.
  const buddySvc = await import("@/services/buddy-service");
  const matchData = await buddySvc.getBreakMatches(userId, now);
  return {
    ...base,
    userStatus: waitingBuddy ? "WAITING_BUDDY" : onCall ? "ON_CALL" : "WORKING",
    focusMode: "WORK",
    nextBreak: next
      ? {
          scheduledStart: next.scheduledStart.toISOString(),
          scheduledEnd: next.scheduledEnd.toISOString(),
          ready: now >= next.scheduledStart,
        }
      : undefined,
    groupBreak: group ?? undefined,
    ...(matchData.matches.length > 0 ? { suggestions: matchData.matches } : {}),
    timerLabel: "تا استراحت بعدی",
    timerSeconds: next ? diffSeconds(next.scheduledStart, now) : 0,
  };
}
