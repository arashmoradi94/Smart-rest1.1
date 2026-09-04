import { prisma } from "@/lib/db";
import { AppError } from "@/lib/utils";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateTime(value: string) {
  if (!TIME_RE.test(value)) throw new AppError("ساعت نامعتبر است", 400);
}

export function buildDinnerSlots(startTime: string, endTime: string) {
  validateTime(startTime);
  validateTime(endTime);
  const start = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3));
  const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3));
  if (end <= start || (end - start) % 20 !== 0) {
    throw new AppError("بازه شام باید مضرب ۲۰ دقیقه و معتبر باشد", 400);
  }
  return Array.from({ length: (end - start) / 20 }, (_, i) => {
    const toTime = (minutes: number) =>
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return { startTime: toTime(start + i * 20), endTime: toTime(start + (i + 1) * 20) };
  });
}

function datesInMonth(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new AppError("ماه نامعتبر است", 400);
  const [year, month] = monthKey.split("-").map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`);
}

export async function getDinnerSchedule(monthKey: string) {
  return prisma.dinnerSchedule.findUnique({
    where: { monthKey },
    include: { assignments: { include: { user: { select: { id: true, name: true, username: true } } } } },
  });
}

export async function saveDinnerSchedule(input: {
  monthKey: string;
  mode: "AUTO" | "MANUAL";
  startTime: string;
  endTime: string;
  assignments?: Array<{ userId: string; date: string; startTime: string; endTime: string }>;
}) {
  const slotList = buildDinnerSlots(input.startTime, input.endTime);
  const dates = datesInMonth(input.monthKey);
  const users = await prisma.user.findMany({ where: { role: { not: "ADMIN" } }, select: { id: true } });
  const eligible = new Set(users.map((u) => u.id));
  const assignments = input.assignments?.filter((a) => eligible.has(a.userId) && dates.includes(a.date)) ?? [];
  if (input.mode === "MANUAL" && assignments.some((a) => !slotList.some((s) => s.startTime === a.startTime && s.endTime === a.endTime))) {
    throw new AppError("زمان دستی باید یکی از نوبت‌های ۲۰ دقیقه‌ای باشد", 400);
  }

  const schedule = await prisma.dinnerSchedule.upsert({
    where: { monthKey: input.monthKey },
    create: { monthKey: input.monthKey, mode: input.mode, startTime: input.startTime, endTime: input.endTime },
    update: { mode: input.mode, startTime: input.startTime, endTime: input.endTime },
  });

  if (input.mode === "AUTO") {
    const userIds = [...eligible].sort();
    // Business rule: ONE fixed dinner time per employee PER MONTH. The slot
    // depends only on the employee index and the MONTH — never on the day —
    // so every day of the month gets the same time for the same employee,
    // and re-running the algorithm (refresh/re-login/restart) reproduces the
    // exact same schedule. The month offset lets next month differ.
    const [y, m] = input.monthKey.split("-").map(Number);
    const monthOffset = (y * 12 + m) % slotList.length;
    const generated = dates.flatMap((date) =>
      userIds.map((userId, index) => {
        const slot = slotList[(index + monthOffset) % slotList.length];
        return { scheduleId: schedule.id, userId, date, ...slot, allocation: "AUTO" };
      }),
    );
    await prisma.$transaction([
      prisma.dinnerAssignment.deleteMany({ where: { scheduleId: schedule.id } }),
      prisma.dinnerAssignment.createMany({ data: generated }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.dinnerAssignment.deleteMany({ where: { scheduleId: schedule.id } }),
      prisma.dinnerAssignment.createMany({
        data: assignments.map((a) => ({ scheduleId: schedule.id, ...a, allocation: "MANUAL" })),
      }),
    ]);
  }
  return getDinnerSchedule(input.monthKey);
}

export async function publishDinnerSchedule(monthKey: string, published: boolean) {
  return prisma.dinnerSchedule.update({ where: { monthKey }, data: { published } });
}

export async function getTodayDinner(userId: string, date: string) {
  const row = await prisma.dinnerAssignment.findFirst({
    where: { userId, date, schedule: { published: true } },
    include: { schedule: true },
  });
  return row;
}

export function dinnerView(row: Awaited<ReturnType<typeof getTodayDinner>>, now = new Date(), timeZone = "Asia/Tehran") {
  if (!row) return undefined;
  const current = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const status: "COMPLETED" | "ACTIVE" | "UPCOMING" =
    current >= row.endTime ? "COMPLETED" : current >= row.startTime ? "ACTIVE" : "UPCOMING";
  const minutesUntilStart = status === "UPCOMING"
    ? Math.max(0, Math.round((Date.parse(`${row.date}T${row.startTime}:00+03:30`) - now.getTime()) / 60_000))
    : undefined;
  return { date: row.date, startTime: row.startTime, endTime: row.endTime, status, minutesUntilStart };
}
