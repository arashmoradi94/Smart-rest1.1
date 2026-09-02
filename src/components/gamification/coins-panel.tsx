"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, Coins, Flame, Gift, Trophy } from "lucide-react";
import { BadgesGallery } from "@/components/gamification/badges-gallery";
import { formatPersianNumber } from "@/lib/utils";
import type { BadgeView } from "@/types";

interface Me {
  balance: number;
  xp: number;
  level: number;
  streakDays: number;
  weeklyCoins: number;
  badges: BadgeView[];
}
interface LbRow {
  rank: number;
  userId: string;
  name: string;
  coins: number;
  onTimeBreaks: number;
  streakDays: number;
}
interface Reward {
  id: string;
  name: string;
  description?: string | null;
  coinCost: number;
  active: boolean;
}

const MEDALS = ["🥇", "🥈", "🥉"];

const PERIODS: Array<{ key: "day" | "week" | "month"; label: string }> = [
  { key: "day", label: "روز" },
  { key: "week", label: "هفته" },
  { key: "month", label: "ماه" },
];

const PERIOD_TITLE: Record<string, string> = { day: "برترین‌های امروز", week: "برترین‌های هفته", month: "برترین‌های ماه" };

export function CoinsPanel({ refreshKey }: { refreshKey: number }) {
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<LbRow[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (p: "day" | "week" | "month") => {
      try {
        const [m, l, r] = await Promise.all([
          fetch("/api/gamification/me", { cache: "no-store" }),
          fetch(`/api/gamification/leaderboard?period=${p}`, { cache: "no-store" }),
          fetch("/api/admin/rewards", { cache: "no-store" }),
        ]);
        if (m.ok) setMe(await m.json());
        if (l.ok) setRows((await l.json()).slice(0, 5));
        if (r.ok) setRewards((await r.json()).filter((x: Reward) => x.active));
      } catch {}
    },
    [],
  );

  useEffect(() => {
    queueMicrotask(() => void load(period));
  }, [load, period, refreshKey]);

  async function redeem(id: string, name: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/gamification/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId: id }),
      });
      const d = await res.json();
      setMsg(res.ok ? `🎉 «${name}» دریافت شد!` : d.error ?? "دریافت ناموفق بود");
      load(period);
    } catch {
      setMsg("ارتباط برقرار نشد");
    } finally {
      setBusy(false);
    }
  }

  if (!me) return null;

  return (
    <section className="glass-card flex flex-col gap-4 rounded-3xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">پیشرفت من</h2>
        <span className="flex items-center gap-1 text-sm font-bold" style={{ color: "var(--warning)" }}>
          <Coins className="size-4" aria-hidden />
          {formatPersianNumber(me.balance)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-3 text-center" style={{ background: "rgba(148,163,184,.08)" }}>
          <p className="text-lg font-bold">{formatPersianNumber(me.level)}</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>سطح</p>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ background: "rgba(148,163,184,.08)" }}>
          <p className="text-lg font-bold" style={{ color: "var(--working)" }}>{formatPersianNumber(me.xp)}</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>XP</p>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ background: "rgba(148,163,184,.08)" }}>
          <p className="flex items-center justify-center gap-1 text-lg font-bold" style={{ color: "var(--danger)" }}>
            <Flame className="size-4" aria-hidden />
            {formatPersianNumber(me.streakDays)}
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>روز متوالی</p>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium" style={{ color: "var(--muted)" }}>
          پیشرفت تا سطح بعد
        </p>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: "rgba(148,163,184,.15)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, ((me.xp % 100) / 100) * 100)}%`,
              background: "var(--break)",
            }}
          />
        </div>
      </div>

      <BadgesGallery badges={me.badges ?? []} />

      {rows.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--muted)" }}>
              <Trophy className="size-4" aria-hidden /> {PERIOD_TITLE[period]}
            </h3>
            <div className="flex gap-0.5 rounded-lg p-0.5" style={{ background: "rgba(148,163,184,.1)" }}>
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  aria-pressed={period === p.key}
                  className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
                    period === p.key ? "text-white" : ""
                  }`}
                  style={period === p.key ? { background: "var(--break)" } : { color: "var(--muted)" }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <ol className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.userId} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm" style={{ background: "rgba(148,163,184,.08)" }}>
                <span className="flex items-center gap-2">
                  <span>{MEDALS[r.rank - 1] ?? `${formatPersianNumber(r.rank)}.`}</span>
                  <span className="font-medium">{r.name}</span>
                  <span className="flex items-center gap-0.5 text-[11px]" style={{ color: "var(--danger)" }}>
                    <Flame className="size-3" aria-hidden />
                    {formatPersianNumber(r.streakDays)}
                  </span>
                </span>
                <bdi className="flex items-center gap-1 font-bold tabular-nums">
                  <Coins className="size-3.5" style={{ color: "var(--warning)" }} aria-hidden />
                  {formatPersianNumber(r.coins)}
                </bdi>
              </li>
            ))}
          </ol>
        </div>
      )}

      {rewards.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--muted)" }}>
            <Gift className="size-4" aria-hidden /> فروشگاه پاداش
          </h3>
          <ul className="flex flex-col gap-2">
            {rewards.map((rw) => (
              <li key={rw.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(148,163,184,.08)" }}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{rw.name}</p>
                  <p className="flex items-center gap-1 text-xs" style={{ color: "var(--warning)" }}>
                    <Award className="size-3" aria-hidden />
                    {formatPersianNumber(rw.coinCost)} سکه
                  </p>
                </div>
                <button
                  onClick={() => redeem(rw.id, rw.name)}
                  disabled={busy || me.balance < rw.coinCost}
                  className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
                  style={{ background: me.balance >= rw.coinCost ? "var(--working)" : "var(--muted)" }}
                >
                  دریافت
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && (
        <p className="text-center text-xs font-medium" role="status" style={{ color: "var(--working)" }}>
          {msg}
        </p>
      )}
    </section>
  );
}
