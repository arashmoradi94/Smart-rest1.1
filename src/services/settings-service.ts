import { prisma } from "@/lib/db";
import type { SchedulerSettings } from "@/types";

export async function getSettings(): Promise<
  SchedulerSettings & {
    earlyNotificationMinutes: number;
    endNotificationMinutes: number;
  }
> {
  const settings = await prisma.settings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      workDurationMinutes: 60,
      breakDurationMinutes: 10,
      maxConcurrentBreaks: 5,
      earlyNotificationMinutes: 2,
      endNotificationMinutes: 2,
    },
    update: {},
  });

  return {
    workDurationMinutes: settings.workDurationMinutes,
    breakDurationMinutes: settings.breakDurationMinutes,
    maxConcurrentBreaks: settings.maxConcurrentBreaks,
    earlyNotificationMinutes: settings.earlyNotificationMinutes,
    endNotificationMinutes: settings.endNotificationMinutes,
  };
}

export async function updateSettings(
  input: Partial<
    SchedulerSettings & {
      earlyNotificationMinutes: number;
      endNotificationMinutes: number;
    }
  >,
) {
  return prisma.settings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      workDurationMinutes: input.workDurationMinutes ?? 60,
      breakDurationMinutes: input.breakDurationMinutes ?? 10,
      maxConcurrentBreaks: input.maxConcurrentBreaks ?? 5,
      earlyNotificationMinutes: input.earlyNotificationMinutes ?? 2,
      endNotificationMinutes: input.endNotificationMinutes ?? 2,
    },
    update: input,
  });
}
