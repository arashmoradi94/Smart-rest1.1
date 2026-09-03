"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Download, Loader2 } from "lucide-react";
import { formatPersianNumber } from "@/lib/utils";
import type { TeamAnalytics } from "@/types";

const PERIODS: Array<{ key: "day" | "week" | "month"; label: string }> = [
  { key: "day", label: "امروز" },
  { key: "week", label: "هفته" },
  { key: "month", label: "ماه" },
];

function Card({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="glass-card rounded-2xl p-3 text-center">
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {title}
      </p>
      {hint && (
        <p className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function toCsv(a: TeamAnalytics): string {
  const rows: string[][] = [
    ["گزارش تیم", PERIODS.find((p) => p.key === a.period)?.label ?? a.period],
    [],
    ["شاخص", "مقدار"],
    ["کل کار (دقیقه)", String(a.totalWorkMinutes)],
    ["کل استراحت (دقیقه)", String(a.totalBreakMinutes)],
    ["میانگین استراحت (دقیقه)", String(a.avgBreakMinutes)],
    ["میانگین تأخیر (دقیقه)", String(a.avgDelayMinutes)],
    ["درصد به‌موقع", String(a.onTimePercent)],
    ["حضور (نفر)", String(a.attendanceCount)],
    ["تعداد استراحت", String(a.breakCount)],
    ["ظرفیت مصرف‌شده (٪)", String(a.capacityUsagePercent)],
    [],
    ["کارمند", "شیفت", "کار (دقیقه)", "استراحت", "دقیقه استراحت", "تأخیر (دقیقه)", "به‌موقع (٪)"],
    ...a.employees.map((e) => [
      e.name,
      String(e.shifts),
      String(e.workMinutes),
      String(e.breakCount),
      String(e.breakMinutes),
      String(e.delayMinutes),
      String(e.onTimePercent),
    ]),
  ];
  return "\uFEFF" + rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\r\n");
}

export function ReportsTab() {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [data, setData] = useState<TeamAnalytics | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: "day" | "week" | "month") => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/analytics?period=${p}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch {
      /* offline */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load(period));
  }, [period, load]);

  function exportCsv() {
    if (!data) return;
    const blob = new Blob([toCsv(data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report-${data.period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const peakMax = data ? Math.max(1, ...data.peakTimes.map((p) => p.count)) : 1;

  return (
    <section className="flex flex-col gap-3">
      <div className="glass-card flex items-center justify-between gap-2 rounded-2xl p-2">
        <div className="flex flex-1 gap-1" role="tablist" aria-label="بازه گزارش">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                period === p.key ? "text-white" : ""
              }`}
              style={period === p.key ? { background: "var(--break)" } : { color: "var(--muted)" }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={exportCsv}
          disabled={!data}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"
          style={{ background: "rgba(100,116,139,.1)", color: "var(--muted)" }}
          aria-label="دریافت گزارش"
        >
          <Download className="size-4" aria-hidden />
          دریافت گزارش
        </button>
      </div>

      {!data ? (
        <div className="glass-card flex h-48 animate-pulse items-center justify-center rounded-3xl">
          {loading && <Loader2 className="size-6 animate-spin" aria-hidden />}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Card title="کل کار" value={`${formatPersianNumber(Math.round(data.totalWorkMinutes / 60))} ساعت`} />
            <Card title="کل استراحت" value={`${formatPersianNumber(data.totalBreakMinutes)} دقیقه`} />
            <Card title="میانگین استراحت" value={`${formatPersianNumber(data.avgBreakMinutes)} دقیقه`} />
            <Card title="میانگین تأخیر" value={`${formatPersianNumber(data.avgDelayMinutes)} دقیقه`} />
            <Card title="به‌موقع" value={`${formatPersianNumber(data.onTimePercent)}٪`} />
            <Card title="ظرفیت مصرفی" value={`${formatPersianNumber(data.capacityUsagePercent)}٪`} />
          </div>

          <div className="glass-card rounded-3xl p-4">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold">
              <BarChart3 className="size-4" aria-hidden />
              ساعات اوج استراحت
            </h3>
            <div className="flex h-24 items-end gap-0.5" dir="ltr">
              {data.peakTimes.map((p) => (
                <div key={p.hour} className="flex flex-1 flex-col items-center gap-0.5">
                  <div
                    className="w-full rounded-t-sm transition-all"
                    style={{
                      height: `${Math.max(4, (p.count / peakMax) * 70)}px`,
                      background: p.count > 0 ? "var(--break)" : "rgba(148,163,184,.15)",
                    }}
                    title={`ساعت ${p.hour}: ${p.count}`}
                  />
                  <span className="text-[9px] tabular-nums" style={{ color: "var(--muted)" }}>
                    {p.hour}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card overflow-x-auto rounded-3xl p-4">
            <h3 className="mb-3 text-sm font-bold">عملکرد کارکنان</h3>
            <table className="w-full text-right text-xs">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="pb-2 font-medium">کارمند</th>
                  <th className="pb-2 font-medium">شیفت</th>
                  <th className="pb-2 font-medium">استراحت</th>
                  <th className="pb-2 font-medium">تأخیر</th>
                  <th className="pb-2 font-medium">به‌موقع</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center" style={{ color: "var(--muted)" }}>
                      داده‌ای برای این بازه وجود ندارد.
                    </td>
                  </tr>
                )}
                {data.employees.map((e) => (
                  <tr key={e.userId} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 font-bold">{e.name}</td>
                    <td className="py-2 tabular-nums">{formatPersianNumber(e.shifts)}</td>
                    <td className="py-2 tabular-nums">
                      {formatPersianNumber(e.breakCount)} بار / {formatPersianNumber(e.breakMinutes)} دقیقه
                    </td>
                    <td className="py-2 tabular-nums" style={{ color: e.delayMinutes > 0 ? "var(--danger)" : undefined }}>
                      {formatPersianNumber(e.delayMinutes)} دقیقه
                    </td>
                    <td className="py-2 tabular-nums">{formatPersianNumber(e.onTimePercent)}٪</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
