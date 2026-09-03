"use client";

import { useCallback, useEffect, useState } from "react";
import { UsersRound } from "lucide-react";
import { useLiveRefresh } from "@/lib/use-live";
import { formatPersianNumber, formatPersianTime } from "@/lib/utils";

interface MonitorGroup {
  id: string;
  status: "ACTIVE" | "READY" | "WAITING" | "WAITING_CALL" | "DELAYED" | "COMPLETED";
  requestedAt?: string;
  durationMinutes?: number;
  capacityStatus?: string;
  startedAt?: string;
  endsAt?: string;
  members: Array<{ userId: string; name: string; ready: boolean; onCall: boolean }>;
  readyCount: number;
  totalCount: number;
}

interface MonitorData {
  enabled: boolean;
  capacity: {
    maxConcurrentBreaks: number;
    activeBreaks: number;
    remaining: number;
    onlineAgents: number;
    loadRatio: number;
    maxLoadRatioPercent: number;
  };
  groups: MonitorGroup[];
}

const STATUS_META: Record<MonitorGroup["status"], { label: string; color: string }> = {
  ACTIVE: { label: "در حال استراحت", color: "var(--break)" },
  READY: { label: "آماده — منتظر ظرفیت", color: "var(--warning)" },
  WAITING: { label: "در انتظار اعضا", color: "var(--muted)" },
  WAITING_CALL: { label: "منتظر پایان تماس عضو", color: "var(--warning)" },
  DELAYED: { label: "به‌تعویق‌افتاده به‌دلیل ظرفیت", color: "var(--danger)" },
  COMPLETED: { label: "تکمیل‌شده", color: "var(--muted)" },
};

export function GroupsTab({ timezone }: { timezone?: string }) {
  const [data, setData] = useState<MonitorData | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/group-breaks", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  useLiveRefresh(load, 30_000);

  if (!data) return <div className="glass-card h-40 animate-pulse rounded-3xl" />;

  return (
    <section className="flex flex-col gap-3">
      <div className="glass-card flex items-center justify-between rounded-2xl px-4 py-3 text-xs">
        <span className="flex items-center gap-1.5 font-bold">
          <UsersRound className="size-4" aria-hidden />
          پایش استراحت گروهی
        </span>
        <span className="flex items-center gap-2" style={{ color: "var(--muted)" }}>
          <span>
            ظرفیت: {formatPersianNumber(data.capacity.activeBreaks)} / {formatPersianNumber(data.capacity.maxConcurrentBreaks)}
          </span>
          <span>·</span>
          <span>
            بار تیم: {formatPersianNumber(data.capacity.loadRatio)}٪ (سقف {formatPersianNumber(data.capacity.maxLoadRatioPercent)}٪)
          </span>
        </span>
      </div>

      {!data.enabled && (
        <p className="glass-card rounded-2xl px-4 py-3 text-center text-xs font-bold" style={{ color: "var(--warning)" }}>
          استراحت گروهی از تنظیمات غیرفعال است.
        </p>
      )}

      {data.groups.length === 0 ? (
        <p className="glass-card rounded-3xl py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
          گروه فعالی وجود ندارد.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.groups.map((g) => {
            const meta = STATUS_META[g.status];
            return (
              <li key={g.id} className="glass-card flex flex-col gap-2 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">
                    ☕ گروه {g.members.map((m) => m.name.split(" ")[0]).join("، ")}
                  </span>
                  <span
                    className="rounded-lg px-2 py-1 text-[11px] font-bold"
                    style={{ background: `color-mix(in srgb, ${meta.color} 12%, transparent)`, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {g.members.map((m) => (
                    <li
                      key={m.userId}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]"
                      style={{ background: "rgba(148,163,184,.08)" }}
                    >
                      <span>{m.name}</span>
                      {m.onCall && <span title="در تماس">📞</span>}
                      <span style={{ color: m.ready ? "var(--working)" : "var(--muted)" }}>
                        {m.ready ? "✓" : "…"}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] tabular-nums" style={{ color: "var(--muted)" }}>
                  {g.startedAt && g.endsAt
                    ? `${formatPersianTime(g.startedAt, timezone)} تا ${formatPersianTime(g.endsAt, timezone)}`
                    : `آماده: ${formatPersianNumber(g.readyCount)} از ${formatPersianNumber(g.totalCount)}`}
                </p>
                <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                  درخواست: {g.requestedAt ? formatPersianTime(g.requestedAt, timezone) : "—"}
                  {g.capacityStatus ? ` · ظرفیت: ${g.capacityStatus}` : ""}
                  {g.durationMinutes !== undefined ? ` · مدت: ${formatPersianNumber(g.durationMinutes)} دقیقه` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
