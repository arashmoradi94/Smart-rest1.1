"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Briefcase,
  Coffee,
  Flag,
  Loader2,
  LogOut,
  PlayCircle,
  StopCircle,
  WifiOff,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { TimerRing } from "@/components/timer-ring";
import { ThemeToggle } from "@/components/theme-toggle";
import { PushSetup, enablePush, notify, requestNotificationPermission } from "@/components/push-setup";
import { formatDuration, formatPersianNumber, formatPersianTime } from "@/lib/utils";
import type { EmployeeDashboardState } from "@/types";

const STATUS_COLOR: Record<string, string> = {
  WORKING: "var(--working)",
  ON_BREAK: "var(--break)",
  LATE: "var(--danger)",
  OFFLINE: "var(--muted)",
};

function Countdown({
  targetMs,
  offsetRef,
  onExpire,
  children,
}: {
  targetMs: number;
  offsetRef: React.RefObject<number>;
  onExpire: () => void;
  children: (seconds: number) => React.ReactNode;
}) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((targetMs - (now + offsetRef.current)) / 1000));
  useEffect(() => {
    if (seconds <= 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [seconds, onExpire]);
  return <>{children(seconds)}</>;
}

function StatCard({ title, value, danger }: { title: string; value: string; danger?: boolean }) {
  return (
    <div className="glass-card rounded-2xl p-4 text-center">
      <p className="text-xs font-medium" style={{ color: "var(--muted)" }}>
        {title}
      </p>
      <p className="mt-1 text-lg font-bold" style={{ color: danger ? "var(--danger)" : undefined }}>
        {value}
      </p>
    </div>
  );
}

export function EmployeeDashboard({ userName }: { userName: string }) {
  const [state, setState] = useState<EmployeeDashboardState | null>(null);
  const offsetRef = useRef(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const notified = useRef<Set<string>>(new Set());

  const apply = useCallback((s: EmployeeDashboardState) => {
    setState(s);
    offsetRef.current = new Date(s.serverTime).getTime() - Date.now();
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error();
      apply(await r.json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [apply]);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchState();
    };
    const onOnline = () => {
      setOffline(false);
      fetchState();
    };
    const onOffline = () => setOffline(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [fetchState]);

  const act = useCallback(
    async (path: string) => {
      if (busy) return;
      setBusy(true);
      setError("");
      setConfirmEnd(false);
      if (path === "/api/shift/start") {
        const granted = await requestNotificationPermission();
        if (granted) enablePush();
      }
      try {
        const r = await fetch(path, { method: "POST" });
        const d = await r.json();
        if (!r.ok) setError(d.error ?? "خطایی رخ داد. دوباره تلاش کنید.");
        else {
          apply(d);
          notified.current.clear();
        }
      } catch {
        setOffline(true);
        setError("ارتباط با سرور برقرار نشد.");
      } finally {
        setBusy(false);
      }
    },
    [apply, busy],
  );

  // Break notifications: early warning, start, end warning, end — fired once per event
  useEffect(() => {
    if (!state?.hasActiveShift) return;
    const fire = (key: string, title: string, body: string) => {
      if (notified.current.has(key)) return;
      notified.current.add(key);
      notify(title, body, key);
    };
    const check = () => {
      const nowServer = Date.now() + offsetRef.current;
      const s = state.settings;
      if (state.userStatus === "WORKING" && state.nextBreak) {
        const start = new Date(state.nextBreak.scheduledStart).getTime();
        const ms = start - nowServer;
        if (ms > 0 && ms <= s.earlyNotificationMinutes * 60_000) {
          fire(`b${start}:early`, "☕ زمان استراحت نزدیک است", `تا شروع استراحت ${s.earlyNotificationMinutes} دقیقه باقی مانده.`);
        } else if (ms <= 0) {
          fire(`b${start}:start`, "☕ استراحت", "زمان استراحت شما شروع شد.");
        }
      } else if ((state.userStatus === "ON_BREAK" || state.userStatus === "LATE") && state.currentBreak) {
        const end = new Date(state.currentBreak.scheduledEnd).getTime();
        const ms = end - nowServer;
        if (ms > 0 && ms <= s.endNotificationMinutes * 60_000) {
          fire(`b${end}:warn`, "⚠️ پایان استراحت نزدیک است", `فقط ${s.endNotificationMinutes} دقیقه تا پایان استراحت باقی مانده.`);
        } else if (ms <= 0) {
          fire(`b${end}:end`, "🔴 پایان استراحت", "زمان استراحت تمام شد. لطفاً آنلاین شوید.");
        }
      }
    };
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, [state]);

  if (!state) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
        <div className="glass-card h-16 animate-pulse rounded-2xl" />
        <div className="glass-card h-72 animate-pulse rounded-3xl" />
        <div className="glass-card h-24 animate-pulse rounded-2xl" />
      </main>
    );
  }

  const color = STATUS_COLOR[state.userStatus] ?? STATUS_COLOR.OFFLINE;
  const isBreak = state.userStatus === "ON_BREAK" || state.userStatus === "LATE";
  const targetMs = isBreak
    ? new Date(state.currentBreak!.scheduledEnd).getTime()
    : state.nextBreak
      ? new Date(state.nextBreak.scheduledStart).getTime()
      : 0;
  const totalSeconds = isBreak
    ? state.settings.breakDurationMinutes * 60
    : state.settings.workDurationMinutes * 60;
  const finished = !state.hasActiveShift && state.shiftEnded;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4 pb-8">
      <PushSetup />
      <header className="glass-card flex items-center justify-between rounded-2xl px-4 py-3">
        <div>
          <h1 className="text-sm font-bold">{userName} عزیز، خوش آمدی 👋</h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            مدیریت استراحت کال‌سنتر
          </p>
        </div>
        <div className="flex gap-2">
          <ThemeToggle />
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex size-10 items-center justify-center rounded-xl transition hover:opacity-70"
            style={{ background: "rgba(100,116,139,.1)", color: "var(--muted)" }}
            aria-label="خروج از حساب"
          >
            <LogOut className="size-5" aria-hidden />
          </button>
        </div>
      </header>

      {offline && (
        <div
          className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium"
          style={{ background: "rgba(245,158,11,.12)", color: "var(--warning)" }}
          role="status"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden />
          اتصال قطع است؛ تایمر ادامه دارد و بعد از اتصال دوباره همگام‌سازی می‌شود.
        </div>
      )}

      {state.hasActiveShift ? (
        <>
          <section className="glass-card flex flex-col items-center gap-4 rounded-3xl p-6">
            <StatusBadge status={state.userStatus} />
            {targetMs > 0 ? (
              <Countdown key={targetMs} targetMs={targetMs} offsetRef={offsetRef} onExpire={fetchState}>
                {(seconds) => (
                  <TimerRing
                    seconds={seconds}
                    totalSeconds={totalSeconds}
                    color={color}
                    label={state.timerLabel}
                    pulsing={state.userStatus === "LATE"}
                  />
                )}
              </Countdown>
            ) : null}
            {state.nextBreak && state.userStatus === "WORKING" && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                استراحت بعدی: ساعت{" "}
                <bdi className="font-bold" style={{ color: "var(--break)" }}>
                  {formatPersianTime(state.nextBreak.scheduledStart)}
                </bdi>{" "}
                تا{" "}
                <bdi className="font-bold">
                  {formatPersianTime(state.nextBreak.scheduledEnd)}
                </bdi>
              </p>
            )}
            {isBreak && state.userStatus === "ON_BREAK" && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                ساعت {formatPersianTime(state.currentBreak!.scheduledStart)} شروع شده — تا{" "}
                {formatPersianTime(state.currentBreak!.scheduledEnd)} فرصت داری استراحت کنی ☕
              </p>
            )}
            {state.userStatus === "LATE" && (
              <p className="text-sm font-medium" style={{ color: "var(--danger)" }}>
                زمان استراحت تمام شده؛ لطفاً همین حالا به کار برگرد.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            {state.userStatus === "WORKING" ? (
              <button
                onClick={() => act("/api/break/start")}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white transition active:scale-[.99] disabled:opacity-60"
                style={{ background: "var(--break)" }}
              >
                {busy ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                ) : (
                  <Coffee className="size-5" aria-hidden />
                )}
                شروع استراحت
              </button>
            ) : (
              <button
                onClick={() => act("/api/break/return")}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white transition active:scale-[.99] disabled:opacity-60"
                style={{ background: "var(--working)" }}
              >
                {busy ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                ) : (
                  <Briefcase className="size-5" aria-hidden />
                )}
                بازگشت به کار
              </button>
            )}

            {confirmEnd ? (
              <div className="glass-card flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
                <span className="text-sm font-medium">شیفتت را پایان می‌دهی؟</span>
                <span className="flex gap-2">
                  <button
                    onClick={() => act("/api/shift/end")}
                    disabled={busy}
                    className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                    style={{ background: "var(--danger)" }}
                  >
                    بله، پایان
                  </button>
                  <button
                    onClick={() => setConfirmEnd(false)}
                    className="rounded-xl px-4 py-2 text-sm font-bold"
                    style={{ background: "rgba(100,116,139,.1)" }}
                  >
                    خیر
                  </button>
                </span>
              </div>
            ) : (
              <button
                onClick={() => setConfirmEnd(true)}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition disabled:opacity-60"
                style={{ background: "rgba(239,68,68,.08)", color: "var(--danger)" }}
              >
                <StopCircle className="size-4" aria-hidden />
                پایان شیفت
              </button>
            )}
          </section>
        </>
      ) : finished ? (
        <section className="glass-card flex flex-col gap-3 rounded-3xl p-6">
          <div className="flex items-center gap-2">
            <Flag className="size-5" style={{ color: "var(--working)" }} aria-hidden />
            <h2 className="font-bold">گزارش پایان شیفت</h2>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            {[
              ["شروع شیفت", formatPersianTime(state.shiftStartedAt!)],
              ["پایان شیفت", formatPersianTime(state.shiftEndedAt!)],
              ["مدت شیفت", formatDuration(state.report!.shiftDurationMinutes)],
              ["تعداد استراحت", formatPersianNumber(state.report!.breakCount)],
              ["استراحت مجاز", formatDuration(state.report!.allowedBreakMinutes)],
              ["استراحت واقعی", formatDuration(state.report!.actualBreakMinutes)],
              ["مجموع تأخیر", formatDuration(state.report!.totalDelayMinutes)],
              [
                "به‌موقع / دیر",
                `${formatPersianNumber(state.report!.onTimeBreaks)} / ${formatPersianNumber(state.report!.lateBreaks)}`,
              ],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex flex-col rounded-xl px-3 py-2"
                style={{ background: "rgba(148,163,184,.08)" }}
              >
                <dt className="text-xs" style={{ color: "var(--muted)" }}>
                  {k}
                </dt>
                <dd className="text-sm font-bold">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {!state.hasActiveShift && !finished && (
        <section className="glass-card flex flex-col items-center gap-4 rounded-3xl p-8 text-center">
          <PlayCircle className="size-12" style={{ color: "var(--working)" }} aria-hidden />
          <h2 className="text-lg font-bold">آماده شروع کار؟</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            با ثبت «شروع شیفت»، زمان واقعی ثبت می‌شود و چرخه کار و استراحت به‌صورت خودکار برایت
            برنامه‌ریزی می‌شود.
          </p>
        </section>
      )}
      {!state.hasActiveShift && (
        <button
          onClick={() => act("/api/shift/start")}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white transition active:scale-[.99] disabled:opacity-60"
          style={{ background: "var(--working)" }}
        >
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <PlayCircle className="size-5" aria-hidden />}
          شروع شیفت
        </button>
      )}

      <section className="grid grid-cols-2 gap-3">
        <StatCard title="تعداد استراحت" value={formatPersianNumber(state.stats.breakCount)} />
        <StatCard title="مجموع استراحت" value={formatDuration(state.stats.totalBreakMinutes)} />
        <StatCard
          title="مجموع تأخیر"
          value={formatDuration(state.stats.totalDelayMinutes)}
          danger={state.stats.totalDelayMinutes > 0}
        />
        <StatCard
          title="استراحت‌های به‌موقع"
          value={`${formatPersianNumber(state.stats.completedBreaks)} از ${formatPersianNumber(state.stats.breakCount)}`}
        />
      </section>

      {state.timeline.length > 0 && (
        <section className="glass-card rounded-3xl p-5">
          <h2 className="mb-4 font-bold">خط زمانی شیفت</h2>
          <ol className="flex flex-col gap-3">
            {state.timeline.map((ev, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl text-base" style={{ background: "rgba(148,163,184,.1)" }}>
                  {ev.icon}
                </span>
                <span className="flex-1 text-sm">{ev.label}</span>
                <bdi className="text-xs font-bold tabular-nums" style={{ color: "var(--muted)" }}>
                  {ev.time}
                </bdi>
              </li>
            ))}
          </ol>
        </section>
      )}

      {error && (
        <div
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-lg"
          style={{ background: "var(--danger)", color: "#fff" }}
          role="alert"
        >
          {error}
        </div>
      )}
    </main>
  );
}
