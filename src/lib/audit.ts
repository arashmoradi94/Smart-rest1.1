import { prisma } from "@/lib/db";

export async function logAudit(userId: string, action: string, details?: string) {
  await prisma.auditLog.create({ data: { userId, action, details } });
}
