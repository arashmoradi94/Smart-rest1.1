import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { prisma } from "@/lib/db";

/**
 * Employee-safe roster for the buddy picker. Only names/ids of employees are
 * exposed — no contact data, no statuses beyond what the buddy flow needs.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    const users = await prisma.user.findMany({
      where: { role: "EMPLOYEE", id: { not: user.id } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return Response.json(users);
  } catch (e) {
    return errorResponse(e);
  }
}
