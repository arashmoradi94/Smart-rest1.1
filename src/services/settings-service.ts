import { prisma } from "@/lib/db";
import type { SchedulerSettings } from "@/types";

export interface AppSettings extends SchedulerSettings {
  earlyNotificationMinutes: number;
  endNotificationMinutes: number;
  timezone: string;
  groupBreakEnabled: boolean;
  groupSuggestWindowMinutes: number;
  maxGroupBreakLoadRatio: number;
}

const DEFAULTS = {
  workDurationMinutes: 60,
  breakDurationMinutes: 10,
  maxConcurrentBreaks: 5,
  earlyNotificationMinutes: 2,
  endNotificationMinutes: 2,
  timezone: "Asia/Tehran",
  groupBreakEnabled: true,
  groupSuggestWindowMinutes: 10,
  maxGroupBreakLoadRatio: 0.3,
};

export async function getSettings(): Promise<AppSettings> {
  const settings = await prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", ...DEFAULTS },
    update: {},
  });

  return {
    workDurationMinutes: settings.workDurationMinutes,
    breakDurationMinutes: settings.breakDurationMinutes,
    maxConcurrentBreaks: settings.maxConcurrentBreaks,
    earlyNotificationMinutes: settings.earlyNotificationMinutes,
    endNotificationMinutes: settings.endNotificationMinutes,
    timezone: settings.timezone,
    groupBreakEnabled: settings.groupBreakEnabled,
    groupSuggestWindowMinutes: settings.groupSuggestWindowMinutes,
    maxGroupBreakLoadRatio: settings.maxGroupBreakLoadRatio,
  };
}

export async function updateSettings(input: Partial<AppSettings>) {
  return prisma.settings.upsert({
    where: { id: "default" },
    create: { id: "default", ...DEFAULTS, ...input },
    update: input,
  });
}
