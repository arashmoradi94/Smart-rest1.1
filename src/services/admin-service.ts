import { prisma } from "@/lib/db";
import { diffMinutes, formatPersianTime } from "@/lib/utils";
import { getSettings } from "@/services/settings-service";
import { autoAdvance, ensureNextBreak, getActiveShift } from "@/services/shift-service";
import type { AdminDashboardState, AdminEmployeeView, UserStatus } from "@/types";
import { logAudit } from "@/lib/audit";

const STATUS_LABEL: Record<string, string> = {
  WORKING: "در حال کار",
  ON_BREAK: "در استراحت",
  LATE: "تأخیر",
  OFFLINE: "آفلاین",
};

export async function getAdminState(now = new Date()): Promise<AdminDashboardState> {
  const settings = await getSettings();
  const users = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    orderBy: { name: "asc" },
  });

  const views: AdminEmployeeView[] = await Promise.all(
    users.map(async (u) => {
      let status: UserStatus = (u.status as UserStatus) || "OFFLINE";
      let breakInfo = "—";
      let delayMinutes = 0;

      const shift = await getActiveShift(u.id);
      if (shift) {
        await autoAdvance(shift, now);
        const fresh = (await getActiveShift(u.id))!;
        const open = fresh.breaks[fresh.breaks.length - 1];
        if (open?.status === "ACTIVE") {
          status = now > open.scheduledEnd ? "LATE" : "ON_BREAK";
          breakInfo = formatPersianTime(open.scheduledEnd, settings.companyTimezone);
          delayMinutes = Math.max(0, diffMinutes(now, open.scheduledEnd));
        } else if (open?.status === "SCHEDULED") {
          status = "WORKING";
          breakInfo = formatPersianTime(open.scheduledStart, settings.companyTimezone);
        } else {
          status = "WORKING";
          await ensureNextBreak(fresh, settings, now);
          const refetched = (await getActiveShift(u.id))!;
          const nb = refetched.breaks[refetched.breaks.length - 1];
          if (nb?.status === "SCHEDULED") {
            breakInfo = formatPersianTime(nb.scheduledStart, settings.companyTimezone);
          }
        }
      }

      return {
        id: u.id,
        name: u.name,
        username: u.username,
        status,
        statusLabel: STATUS_LABEL[status] ?? status,
        breakInfo,
        delayMinutes,
      };
    }),
  );

  const stats = {
    total: users.length,
    working: views.filter((v) => v.status === "WORKING").length,
    onBreak: views.filter((v) => v.status === "ON_BREAK").length,
    late: views.filter((v) => v.status === "LATE").length,
    offline: views.filter((v) => v.status === "OFFLINE").length,
  };

  return { serverTime: now.toISOString(), stats, employees: views, settings };
}

export async function adminUpdateSettings(adminId: string, input: Record<string, number>) {
  const allowed = [
    "workDurationMinutes",
    "breakDurationMinutes",
    "maxConcurrentBreaks",
    "earlyNotificationMinutes",
    "endNotificationMinutes",
  ];
  const filtered: Record<string, number> = {};
  for (const k of allowed) {
    if (k in input && typeof input[k] === "number" && input[k] > 0) filtered[k] = input[k];
  }
  await getSettings();
  const { updateSettings } = await import("@/services/settings-service");
  const result = await updateSettings(filtered);
  await logAudit(adminId, "UPDATE_SETTINGS", JSON.stringify(filtered));
  return result;
}

export async function adminCreateUser(
  adminId: string,
  name: string,
  username: string,
  password: string,
  role: string,
) {
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name, username, passwordHash: hash, role } });
  await logAudit(adminId, "CREATE_USER", `${username} (${role})`);
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

export async function adminOverrideBreak(adminId: string, userId: string, action: "start" | "return") {
  const shift = await getActiveShift(userId);
  if (!shift) throw new Error("شیفت فعالی برای این کاربر وجود ندارد");

  if (action === "start") {
    const { startBreak } = await import("@/services/break-service");
    const result = await startBreak(userId);
    await logAudit(adminId, "OVERRIDE_BREAK_START", userId);
    return result;
  } else {
    const { returnToWork } = await import("@/services/break-service");
    const result = await returnToWork(userId);
    await logAudit(adminId, "OVERRIDE_BREAK_RETURN", userId);
    return result;
  }
}
