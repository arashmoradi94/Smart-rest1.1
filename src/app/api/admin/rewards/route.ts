import { requireAdmin } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { AppError } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await prisma.reward.findMany({ orderBy: { createdAt: "desc" } }));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const { name, description, coinCost, limitCount } = await request.json();
    if (!name?.trim() || !coinCost || coinCost < 1) throw new AppError("نام و هزینه سکه معتبر الزامی است");
    const reward = await prisma.reward.create({
      data: { name: name.trim(), description, coinCost, limitCount: limitCount ?? null },
    });
    await logAudit(admin.id, "CREATE_REWARD", `${name} (${coinCost} coins)`);
    return Response.json(reward);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireAdmin();
    const { id, active } = await request.json();
    if (!id || typeof active !== "boolean") throw new AppError("پارامتر نامعتبر");
    await prisma.reward.update({ where: { id }, data: { active } });
    await logAudit(admin.id, active ? "ENABLE_REWARD" : "DISABLE_REWARD", id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
