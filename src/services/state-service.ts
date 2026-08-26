import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { diffSeconds, formatPersianNumber, formatPersianTime } from "@/lib/utils";
import { getSettings } from "@/services/settings-service";
import {
  autoAdvance,
  buildShiftReport,
  ensureNextBreak,
  getActiveShift,
  nextUserStatus,
} from "@/services/shift-service";
import type { EmployeeDashboardState, TimelineEvent } from "@/types";

type BreakRow = Prisma.BreakGetPayload<{}>;
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

function buildTimeline(shift: ShiftRow): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { time: formatPersianTime(shift.startedAt), label: "شروع شیفت", icon: "🚀", type: "shift_start" },
  ];
  for (const b of shift.breaks) {
    if (b.actualStart) {
      events.push({
        time: formatPersianTime(b.actualStart),
        label: `شروع استراحت ${formatPersianNumber(b.breakIndex + 1)}`,
        icon: "☕",
        type: "break",
      });
    } else if (b.status === "SKIPPED") {
      events.push({
        time: formatPersianTime(b.scheduledStart),
        label: `استراحت ${formatPersianNumber(b.breakIndex + 1)} انجام نشد`,
        icon: "🚫",
        type: "break",
      });
    }
    if (b.actualEnd) {
      events.push({
        time: formatPersianTime(b.actualEnd),
        label: "بازگشت به کار",
        icon: "💼",
        type: "return",
      });
    }
  }
  if (shift.endedAt) {
    events.push({
      time: formatPersianTime(shift.endedAt),
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
    const last = await prisma.shift.findFirst({
      where: { userId, status: "ENDED" },
      orderBy: { endedAt: "desc" },
      include: { breaks: { orderBy: { breakIndex: "asc" } } },
    });
    if (last?.endedAt) {
      return {
        hasActiveShift: false,
        shiftEnded: true,
        userStatus: "OFFLINE",
        serverTime,
        shiftStartedAt: last.startedAt.toISOString(),
        shiftEndedAt: last.endedAt.toISOString(),
        timerLabel: "شیفت شما به پایان رسید",
        timerSeconds: 0,
        stats: buildStats(last.breaks, settings.breakDurationMinutes),
        timeline: buildTimeline(last),
        report: buildShiftReport(last, settings.breakDurationMinutes, last.endedAt),
        settings,
      };
    }
    return {
      hasActiveShift: false,
      shiftEnded: false,
      userStatus: "OFFLINE",
      serverTime,
      timerLabel: "برای شروع، دکمه «شروع شیفت» را بزنید",
      timerSeconds: 0,
      stats: buildStats([], settings.breakDurationMinutes),
      timeline: [],
      settings,
    };
  }

  if (await autoAdvance(shift, now)) shift = (await getActiveShift(userId))!;
  await ensureNextBreak(shift, settings, now);
  shift = (await getActiveShift(userId))!;

  const open = shift.breaks[shift.breaks.length - 1];
  const base = {
    hasActiveShift: true,
    shiftEnded: false,
    serverTime,
    shiftStartedAt: shift.startedAt.toISOString(),
    stats: buildStats(shift.breaks, settings.breakDurationMinutes),
    timeline: buildTimeline(shift),
    settings,
  };

  if (open?.status === "ACTIVE") {
    const overdue = now > open.scheduledEnd;
    return {
      ...base,
      userStatus: nextUserStatus(open, now),
      currentBreak: {
        id: open.id,
        scheduledStart: open.scheduledStart.toISOString(),
        scheduledEnd: open.scheduledEnd.toISOString(),
        actualStart: open.actualStart?.toISOString(),
        status: open.status,
      },
      timerLabel: overdue ? "تأخیر بازگشت به کار" : "زمان باقی‌مانده استراحت",
      timerSeconds: overdue
        ? diffSeconds(now, open.scheduledEnd)
        : diffSeconds(open.scheduledEnd, now),
    };
  }

  const next = open?.status === "SCHEDULED" ? open : undefined;
  return {
    ...base,
    userStatus: "WORKING",
    nextBreak: next
      ? {
          scheduledStart: next.scheduledStart.toISOString(),
          scheduledEnd: next.scheduledEnd.toISOString(),
        }
      : undefined,
    timerLabel: "تا استراحت بعدی",
    timerSeconds: next ? diffSeconds(next.scheduledStart, now) : 0,
  };
}
