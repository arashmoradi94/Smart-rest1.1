import { z } from "zod";
import { requireSupervisor } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, rewardSchema } from "@/lib/validators";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "read");
    return Response.json(await prisma.reward.findMany({ orderBy: { createdAt: "desc" } }));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const input = validate(rewardSchema, await readJson(request));
    const reward = await prisma.reward.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        coinCost: input.coinCost,
        limitCount: input.limitCount ?? null,
      },
    });
    await logAudit(admin.id, "CREATE_REWARD", `${input.name} (${input.coinCost} coins)`);
    return Response.json(reward);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: Request) {
  try {
    const admin = await requireSupervisor();
    limit(request, admin.id, "write");
    const { id, active } = validate(
      z.object({ id: z.string().min(1).max(64), active: z.boolean() }),
      await readJson(request),
    );
    await prisma.reward.update({ where: { id }, data: { active } });
    await logAudit(admin.id, active ? "ENABLE_REWARD" : "DISABLE_REWARD", id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
