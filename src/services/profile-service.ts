import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/utils";
import { logAudit } from "@/lib/audit";

export async function getOwnProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, username: true, role: true, status: true },
  });
  if (!user) throw new AppError("کاربر یافت نشد", 404);
  return user;
}

export async function updateOwnProfile(userId: string, name: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { name: name.trim() },
    select: { id: true, name: true, username: true, role: true, status: true },
  });
  await logAudit(userId, "USER_PROFILE_UPDATED");
  return user;
}

export async function changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new AppError("کاربر یافت نشد", 404);
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError("رمز عبور فعلی نادرست است", 400);
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt: new Date() },
  });
  await logAudit(userId, "USER_PASSWORD_CHANGED");
  return { ok: true };
}
