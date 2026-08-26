import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { AppError } from "@/lib/utils";

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const { message } = await request.json();
    if (!message?.trim()) throw new AppError("متن اطلاعیه الزامی است");
    const { prisma } = await import("@/lib/db");
    const { logAudit } = await import("@/lib/audit");
    // Store as key-value in Settings table via dedicated Announcement model-less approach:
    // reuse AuditLog latest announcement as source for employees (simple + already audited)
    await logAudit(admin.id, "ANNOUNCEMENT", message.trim().slice(0, 500));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
