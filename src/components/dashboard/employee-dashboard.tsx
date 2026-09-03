"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  Briefcase,
  Coffee,
  AlertTriangle,
  Flag,
  Loader2,
  LogOut,
  PlayCircle,
  StopCircle,
  WifiOff,
  MessageSquare,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { TimerRing } from "@/components/timer-ring";
import { ThemeToggle } from "@/components/theme-toggle";
import { PushSetup, enablePush, notify, requestNotificationPermission, type NotificationKind } from "@/components/push-setup";
import { AnalyticsPanel } from "@/components/analytics-panel";
import { BuddyPanel } from "@/components/buddy/buddy-panel";
import { CoinsPanel } from "@/components/gamification/coins-panel";
import { formatDuration, formatPersianNumber, formatPersianTime } from "@/lib/utils";
import { useLiveRefresh } from "@/lib/use-live";
import type { EmployeeDashboardState } from "@/types";

const STATUS_COLOR: Record<string, string> = {
  WORKING: "var(--working)",
  ON_BREAK: "var(--break)",
  EMERGENCY: "var(--danger)",
  LATE: "var(--danger)",
  OFFLINE: "var(--muted)",
};

function Countdown({
  targetMs,
  offset,
  onExpire,
  children,
}: {
  targetMs: number;
  offset: number;
  onExpire: () => void;
  children: (seconds: number) => React.ReactNode;
}) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((targetMs - (now + offset)) / 1000));
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
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const notified = useRef<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  const seenAnnouncement = useRef("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState<"RESTROOM" | "ILLNESS" | "URGENT_REST" | "OTHER">("RESTROOM");
  const [emergencyNote, setEmergencyNote] = useState("");
  const [messages, setMessages] = useState<Array<{
    id: string;
    message: string;
    isRead: boolean;
    createdAt: string;
    readAt?: string | null;
    sender: { name: string; username: string };
  }>>([]);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const messageNoticeIds = useRef<Set<string>>(new Set());

  const apply = useCallback((s: EmployeeDashboardState) => {
    setState(s);
    offsetRef.current = new Date(s.serverTime).getTime() - Date.now();
    setClockOffset(new Date(s.serverTime).getTime() - Date.now());
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error();
      apply(await r.json());
      setOffline(false);
      try {
        const ar = await fetch("/api/announcement", { cache: "no-store" });
        if (ar.ok) {
          const ad = await ar.json();
          if (ad.message) {
            if (seenAnnouncement.current && ad.message !== seenAnnouncement.current) {
              notify("📢 اطلاعیه جدید", ad.message, "announcement", "announcement");
            }
            seenAnnouncement.current = ad.message;
            setAnnouncement(ad.message);
          } else setAnnouncement("");
        }
      } catch {}
    } catch {
      setOffline(true);
    }
  }, [apply]);

  const fetchMessages = useCallback(async () => {
    try {
      const r = await fetch("/api/messages", { cache: "no-store" });
      if (!r.ok) return;
      const next = await r.json();
      for (const item of next as typeof messages) {
        if (!item.isRead && !messageNoticeIds.current.has(item.id)) {
          messageNoticeIds.current.add(item.id);
          notify("پیام جدید از سرپرست", item.message, `direct-message:${item.id}`, "announcement");
        }
      }
      setMessages(next);
    } catch {
      // State polling remains independent from optional message refresh.
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void fetchState());
    const onOnline = () => {
      setOffline(false);
      fetchState();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [fetchState]);

  // SSE live updates + 60s polling fallback + visibility refresh
  useLiveRefresh(fetchState, 60_000);

  useEffect(() => {
    const initial = setTimeout(() => void fetchMessages(), 0);
    const id = setInterval(fetchMessages, 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [fetchMessages]);

  useEffect(() => {
    if (!messagesOpen) return;
    const unread = messages.filter((item) => !item.isRead);
    if (unread.length === 0) return;
    void Promise.all(
      unread.map((item) =>
        fetch("/api/messages", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: item.id }),
        }),
      ),
    ).then((responses) => {
      if (responses.every((response) => response.ok)) {
        setMessages((current) =>
          current.map((item) =>
            item.isRead ? item : { ...item, isRead: true, readAt: new Date().toISOString() },
          ),
        );
      }
    });
  }, [messagesOpen, messages]);

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
          setRefreshKey((k) => k + 1);
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
    const fire = (key: string, title: string, body: string, kind: NotificationKind) => {
      if (notified.current.has(key)) return;
      notified.current.add(key);
      notify(title, body, key, kind);
    };
    const check = () => {
      const nowServer = Date.now() + offsetRef.current;
      const s = state.settings;
      if (state.userStatus === "WORKING" && state.nextBreak) {
        const start = new Date(state.nextBreak.scheduledStart).getTime();
        const ms = start - nowServer;
        if (ms > 0 && ms <= s.earlyNotificationMinutes * 60_000) {
          fire(`b${start}:early`, "☕ زمان استراحت نزدیک است", `تا شروع استراحت ${s.earlyNotificationMinutes} دقیقه باقی مانده.`, "reminder");
        } else if (ms <= 0) {
          fire(`b${start}:start`, "☕ استراحت", "زمان استراحت شما شروع شد.", "break-start");
        }
      } else if ((state.userStatus === "ON_BREAK" || state.userStatus === "LATE") && state.currentBreak) {
        const end = new Date(state.currentBreak.endsAt ?? state.currentBreak.scheduledEnd).getTime();
        const ms = end - nowServer;
        if (ms > 0 && ms <= s.endNotificationMinutes * 60_000) {
          fire(`b${end}:warn`, "⚠️ پایان استراحت نزدیک است", `فقط ${s.endNotificationMinutes} دقیقه تا پایان استراحت باقی مانده.`, "reminder");
        } else if (ms <= 0) {
          fire(`b${end}:end`, "🔴 پایان استراحت", "زمان استراحت تمام شد. لطفاً آنلاین شوید.", "break-end");
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
  const isBreak = state.userStatus === "ON_BREAK" || state.userStatus === "LATE" || state.userStatus === "EMERGENCY";
  const targetMs = state.userStatus === "EMERGENCY"
    ? 0
    : isBreak
    ? new Date(state.currentBreak!.endsAt ?? state.currentBreak!.scheduledEnd).getTime()
    : state.nextBreak
      ? new Date(state.nextBreak.scheduledStart).getTime()
      : 0;
  const totalSeconds = state.userStatus === "EMERGENCY"
    ? Math.max(1, state.timerSeconds)
    : isBreak
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
            مدیریت استراحت مرکز تماس
          </p>
        </div>
        <div className="flex gap-2">
          <ThemeToggle />
          <button
            onClick={() => setMessagesOpen((open) => !open)}
            className="relative flex size-10 items-center justify-center rounded-xl transition hover:opacity-70"
            style={{ background: "rgba(99,102,241,.1)", color: "var(--break)" }}
            aria-label="پیام‌ها"
            aria-pressed={messagesOpen}
          >
            <MessageSquare className="size-5" aria-hidden />
            {messages.some((m) => !m.isRead) && (
              <span className="absolute -right-1 -top-1 flex min-w-5 animate-pulse items-center justify-center rounded-full px-1 text-[10px] font-bold text-white" style={{ background: "var(--danger)" }}>
                {formatPersianNumber(messages.filter((m) => !m.isRead).length)}
              </span>
            )}
          </button>
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


      {announcement && (
        <div
          className="rounded-2xl px-4 py-3 text-sm font-medium"
          style={{ background: "rgba(245,158,11,.12)", color: "var(--warning)" }}
          role="status"
        >
          📢 {announcement}
        </div>
      )}
      {messagesOpen && (
        <section className="glass-card rounded-2xl p-4" aria-label="پیام‌ها">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
            <MessageSquare className="size-4" aria-hidden /> پیام‌ها
          </h2>
          {messages.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>پیامی ندارید.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {messages.map((item) => (
                <li key={item.id} className="rounded-xl p-3 text-sm" style={{ background: "rgba(148,163,184,.08)" }}>
                  <p>{item.message}</p>
                  <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                    {item.sender.name} · {new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}
                    {" · "}{item.isRead ? "خوانده‌شده" : "خوانده‌نشده"}
                  </p>
                  {!item.isRead && (
                    <button
                      className="mt-2 rounded-lg px-2 py-1 text-xs font-bold text-white"
                      style={{ background: "var(--break)" }}
                      onClick={async () => {
                        const r = await fetch("/api/messages", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: item.id }) });
                        if (r.ok) {
                          setMessages((current) => current.map((message) => message.id === item.id ? { ...message, isRead: true, readAt: new Date().toISOString() } : message));
                        }
                      }}
                    >
                      علامت‌گذاری به‌عنوان خوانده‌شده
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {state.dinner && (
        <section className="glass-card rounded-2xl px-4 py-3">
          <h2 className="text-sm font-bold">🍽️ زمان شام امروز</h2>
          <p className="mt-1 text-sm">
            <bdi>{state.dinner.startTime}</bdi> تا <bdi>{state.dinner.endTime}</bdi>
          </p>
          <p className="mt-1 text-xs" style={{ color: state.dinner.status === "ACTIVE" ? "var(--working)" : "var(--muted)" }}>
            {state.dinner.status === "ACTIVE"
              ? "زمان شام شما فرا رسیده است"
              : state.dinner.status === "COMPLETED"
                ? "زمان شام به پایان رسید"
                : `${formatPersianNumber(state.dinner.minutesUntilStart ?? 0)} دقیقه تا شروع شام`}
          </p>
        </section>
      )}
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
              <Countdown key={targetMs} targetMs={targetMs} offset={clockOffset} onExpire={fetchState}>
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
                  {formatPersianTime(state.nextBreak.scheduledStart, state.settings.timezone)}
                </bdi>{" "}
                تا{" "}
                <bdi className="font-bold">
                  {formatPersianTime(state.nextBreak.scheduledEnd, state.settings.timezone)}
                </bdi>
              </p>
            )}
            {isBreak && state.userStatus === "ON_BREAK" && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                ساعت {formatPersianTime(state.currentBreak!.actualStart ?? state.currentBreak!.scheduledStart, state.settings.timezone)} شروع شده — تا{" "}
                {formatPersianTime(state.currentBreak!.endsAt ?? state.currentBreak!.scheduledEnd, state.settings.timezone)} فرصت داری استراحت کنی ☕
              </p>
            )}
            {state.userStatus === "EMERGENCY" && state.emergencyBreak && (
              <p className="text-sm font-medium" style={{ color: "var(--danger)" }}>
                استراحت اضطراری از ساعت {formatPersianTime(state.emergencyBreak.startedAt, state.settings.timezone)} آغاز شده است.
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
            <>
              <button
                onClick={() => act("/api/break/start")}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold text-white transition active:scale-[.99] disabled:opacity-60"
                style={{ background: "var(--break)" }}
              >
                {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Coffee className="size-5" aria-hidden />}
                شروع استراحت
              </button>
              <button
                onClick={() => setEmergencyOpen(true)}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition disabled:opacity-60"
                style={{ background: "rgba(239,68,68,.1)", color: "var(--danger)" }}
              >
                <AlertTriangle className="size-4" aria-hidden />
                استراحت اضطراری
              </button>
            </>
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

            {emergencyOpen && (
              <div className="glass-card flex flex-col gap-3 rounded-2xl p-4">
                <h2 className="text-sm font-bold">دلیل استراحت اضطراری</h2>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ["RESTROOM", "🚻 سرویس بهداشتی"],
                    ["ILLNESS", "🤒 کسالت / حال نامساعد"],
                    ["URGENT_REST", "🧘 نیاز فوری به استراحت"],
                    ["OTHER", "⚠️ سایر موارد ضروری"],
                  ] as const).map(([value, label]) => (
                    <button key={value} onClick={() => setEmergencyReason(value)} className="rounded-xl px-2 py-2 text-xs font-bold" style={{ background: emergencyReason === value ? "var(--danger)" : "rgba(148,163,184,.1)", color: emergencyReason === value ? "white" : undefined }}>
                      {label}
                    </button>
                  ))}
                </div>
                {emergencyReason === "OTHER" && (
                  <textarea value={emergencyNote} onChange={(e) => setEmergencyNote(e.target.value)} maxLength={240} placeholder="توضیح کوتاه (اختیاری)" className="min-h-20 rounded-xl border border-slate-300/20 bg-transparent p-2 text-sm" />
                )}
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setEmergencyOpen(false);
                      setBusy(true);
                      setError("");
                      try {
                        const r = await fetch("/api/break/emergency", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: emergencyReason, note: emergencyNote }) });
                        const d = await r.json();
                        if (!r.ok) setError(d.error ?? "شروع استراحت اضطراری ناموفق بود");
                        else apply(d);
                      } catch {
                        setOffline(true);
                        setError("ارتباط با سرور برقرار نشد.");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="flex-1 rounded-xl py-2 text-sm font-bold text-white"
                    style={{ background: "var(--danger)" }}
                  >
                    شروع فوری
                  </button>
                  <button onClick={() => setEmergencyOpen(false)} className="rounded-xl px-4 py-2 text-sm" style={{ background: "rgba(148,163,184,.1)" }}>
                    انصراف
                  </button>
                </div>
              </div>
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
              ["شروع شیفت", formatPersianTime(state.shiftStartedAt!, state.settings.timezone)],
              ["پایان شیفت", formatPersianTime(state.shiftEndedAt!, state.settings.timezone)],
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

      <AnalyticsPanel />

      <BuddyPanel userStatus={state.userStatus} suggestions={state.suggestions} timezone={state.settings.timezone} />

      <CoinsPanel refreshKey={refreshKey} />

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
