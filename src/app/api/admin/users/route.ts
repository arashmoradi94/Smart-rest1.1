import { requireAdmin } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, createUserSchema, updateUserRoleSchema } from "@/lib/validators";
import { AppError } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { adminCreateUser, adminUpdateUserRole } from "@/services/admin-service";
import { logAudit } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin();
    limit(request, admin.id, "read");
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, username: true, role: true, status: true, onCall: true, createdAt: true },
    });
    return Response.json(users);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    limit(request, admin.id, "write");
    const input = validate(createUserSchema, await readJson(request));
    return Response.json(
      await adminCreateUser(admin.id, input.name, input.username, input.password, input.role),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

/** Change a user's role (RBAC administration). */
export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    limit(request, admin.id, "write");
    const { id, role } = validate(updateUserRoleSchema, await readJson(request));
    return Response.json(await adminUpdateUserRole(admin.id, id, role));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    limit(request, admin.id, "write");
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AppError("id الزامی است");
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new AppError("کاربر یافت نشد", 404);
    if (target.role === "ADMIN") throw new AppError("نمی‌توانید ادمین را حذف کنید", 403);
    if (target.id === admin.id) throw new AppError("نمی‌توانید خودتان را حذف کنید", 403);
    await prisma.user.delete({ where: { id } });
    await logAudit(admin.id, "DELETE_USER", target.username);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
