import { prisma } from "@/lib/db";

/**
 * Best-effort audit trail: an audit failure must never break the user's
 * action — log it server-side instead.
 */
export async function logAudit(userId: string, action: string, details?: string) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, ...(details !== undefined ? { details: details.slice(0, 500) } : {}) },
    });
  } catch (err) {
    console.error("[audit]", action, err);
  }
}
