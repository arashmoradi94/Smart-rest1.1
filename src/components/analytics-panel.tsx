"use client";

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { formatPersianNumber } from "@/lib/utils";

interface Stats {
  days: number;
  breakCount: number;
  lateCount: number;
  avgBreakMinutes: number;
  totalBreakMinutes: number;
  totalDelayMinutes: number;
  peakHour: number;
}

export function AnalyticsPanel() {
  const [days, setDays] = useState(1);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/analytics?days=${days}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setStats(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (!stats) return null;

  const items: Array<[string, string]> = [
    ["تعداد استراحت", formatPersianNumber(stats.breakCount)],
    ["میانگین استراحت", `${formatPersianNumber(stats.avgBreakMinutes)} دقیقه`],
    ["مجموع استراحت", `${formatPersianNumber(stats.totalBreakMinutes)} دقیقه`],
    ["بازگشت دیر", formatPersianNumber(stats.lateCount)],
    ["مجموع تأخیر", `${formatPersianNumber(stats.totalDelayMinutes)} دقیقه`],
    [
      "اوج استراحت",
      `${formatPersianNumber(stats.peakHour)}:۰۰`,
    ],
  ];

  return (
    <section className="glass-card flex flex-col gap-3 rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <BarChart3 className="size-4" aria-hidden />
          آمار {stats.days === 1 ? "امروز" : "هفته"}
        </h2>
        <span className="flex rounded-xl p-1 text-xs font-bold" style={{ background: "rgba(148,163,184,.1)" }} role="tablist">
          {([1, 7] as const).map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={days === d}
              onClick={() => setDays(d)}
              className="rounded-lg px-3 py-1 transition"
              style={days === d ? { background: "var(--break)", color: "#fff" } : { color: "var(--muted)" }}
            >
              {d === 1 ? "روزانه" : "هفتگی"}
            </button>
          ))}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-xl px-2 py-2.5 text-center" style={{ background: "rgba(148,163,184,.08)" }}>
            <dd className="text-sm font-bold tabular-nums">{v}</dd>
            <dt className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>{k}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
