import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await requireAuth();
    const row = await prisma.auditLog.findFirst({
      where: { action: "ANNOUNCEMENT" },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ message: row?.details ?? "", at: row?.createdAt ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
