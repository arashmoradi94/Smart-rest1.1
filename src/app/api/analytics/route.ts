import { requireAuth } from "@/lib/auth";
import { errorResponse, limit } from "@/lib/api";
import { prisma } from "@/lib/db";
import { companyDayKey, companyHour } from "@/lib/time";
import { getSettings } from "@/services/settings-service";

/**
 * Daily/weekly/monthly break & delay analytics for the current user.
 * All computations server-side from Break rows, bucketed in the company timezone.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "read");
    const p = new URL(request.url).searchParams.get("days");
    const days = p === "7" ? 7 : p === "30" ? 30 : 1;
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const settings = await getSettings();

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

    // Peak break times: histogram by company-timezone hour of actual start
    const hours = Array(24).fill(0) as number[];
    for (const b of done) {
      if (b.actualStart) hours[companyHour(b.actualStart, settings.timezone)]++;
    }
    const peakHour = hours.indexOf(Math.max(...hours));

    // Daily buckets for the heatmap
    const dailyMap = new Map<string, { minutes: number; count: number }>();
    for (const b of done) {
      if (!b.actualStart) continue;
      const key = companyDayKey(b.actualStart, settings.timezone);
      const row = dailyMap.get(key) ?? { minutes: 0, count: 0 };
      row.minutes += b.durationMinutes ?? 0;
      row.count += 1;
      dailyMap.set(key, row);
    }

    return Response.json({
      days,
      breakCount: done.length,
      lateCount: late,
      avgBreakMinutes: done.length ? Math.round(totalBreak / done.length) : 0,
      avgDelayMinutes: done.length ? Math.round(totalDelay / done.length) : 0,
      totalBreakMinutes: totalBreak,
      totalDelayMinutes: totalDelay,
      onTimePercent: done.length ? Math.round(((done.length - late) / done.length) * 100) : 100,
      peakHour,
      hourlyHistogram: hours,
      daily: [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
