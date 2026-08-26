import { requireAuth } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

/**
 * Daily/weekly break & delay analytics for the current user.
 * All computations server-side from Break rows.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const days = new URL(request.url).searchParams.get("days") === "7" ? 7 : 1;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);

    const breaks = await prisma.break.findMany({
      where: {
        userId: user.id,
        status: { in: ["COMPLETED", "LATE"] },
        shift: { startedAt: { gte: since } },
      },
      select: {
        durationMinutes: true,
        endDelayMinutes: true,
        status: true,
        actualStart: true,
        scheduledStart: true,
      },
    });

    const done = breaks.filter((b) => b.durationMinutes !== null);
    const totalBreak = done.reduce((s, b) => s + (b.durationMinutes ?? 0), 0);
    const totalDelay = done.reduce((s, b) => s + b.endDelayMinutes, 0);
    const late = done.filter((b) => b.endDelayMinutes > 0).length;

    // Peak break times: histogram by hour of actual start
    const hours = Array(24).fill(0) as number[];
    for (const b of done) {
      if (b.actualStart) hours[b.actualStart.getHours()]++;
    }
    const peakHour = hours.indexOf(Math.max(...hours));

    return Response.json({
      days,
      breakCount: done.length,
      lateCount: late,
      avgBreakMinutes: done.length ? Math.round(totalBreak / done.length) : 0,
      avgDelayMinutes: done.length ? Math.round(totalDelay / done.length) : 0,
      totalBreakMinutes: totalBreak,
      totalDelayMinutes: totalDelay,
      peakHour,
      hourlyHistogram: hours,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
