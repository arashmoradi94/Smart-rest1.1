import { prisma } from "@/lib/db";
import { getProductionConfigIssues } from "@/lib/runtime-config";

export async function GET() {
  const configIssues = getProductionConfigIssues();
  if (configIssues.length > 0) {
    return Response.json({ status: "degraded" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", time: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ status: "degraded" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
