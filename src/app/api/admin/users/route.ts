import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { AppError } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { adminCreateUser } from "@/services/admin-service";
import { logAudit } from "@/lib/audit";

export async function GET() {
  try {
    await requireAdmin();
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, username: true, role: true, status: true, createdAt: true },
    });
    return Response.json(users);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const { name, username, password, role } = await request.json();
    if (!name || !username || !password) throw new AppError("نام، نام کاربری و رمز عبور الزامی است");
    return Response.json(await adminCreateUser(admin.id, name, username, password, role ?? "EMPLOYEE"));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AppError("id الزامی است");
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError("کاربر یافت نشد", 404);
    if (target.role === "ADMIN") throw new AppError("نمی‌توانید ادمین را حذف کنید", 403);
    await prisma.user.delete({ where: { id } });
    await logAudit(admin.id, "DELETE_USER", target.username);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
