"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ReportsTab } from "@/components/admin/reports-tab";
import { AuditTab } from "@/components/admin/audit-tab";
import { UsersTab } from "@/components/admin/users-tab";
import { GroupsTab } from "@/components/admin/groups-tab";
import { DinnerTab } from "@/components/admin/dinner-tab";
import {
  BarChart3,
  Briefcase,
  Clock,
  Coffee,
  Hourglass,
  Loader2,
  LogOut,
  ScrollText,
  Settings,
  Timer,
  Users,
  UsersRound,
  MessageSquare,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { useLiveRefresh } from "@/lib/use-live";
import { formatPersianNumber } from "@/lib/utils";
import type { AdminDashboardState, FullSettings, UserStatus } from "@/types";

const TIMEZONES = [
  "Asia/Tehran",
  "Asia/Dubai",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "UTC",
];

const SETTING_FIELDS: Array<{ key: keyof FullSettings; label: string; min: number }> = [
  { key: "workDurationMinutes", label: "مدت کار (دقیقه)", min: 10 },
  { key: "breakDurationMinutes", label: "مدت استراحت (دقیقه)", min: 5 },
  { key: "maxConcurrentBreaks", label: "حداکثر استراحت همزمان", min: 1 },
  { key: "earlyNotificationMinutes", label: "اعلان قبل از استراحت (دقیقه)", min: 1 },
  { key: "endNotificationMinutes", label: "هشدار پایان استراحت (دقیقه)", min: 1 },
  { key: "groupSuggestWindowMinutes", label: "پنجره پیشنهاد Buddy (دقیقه)", min: 3 },
];

function fmt(iso?: string, timeZone?: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function fmtCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

type Tab = "live" | "groups" | "dinner" | "reports" | "audit" | "users" | "settings";

export function AdminDashboard({ adminName }: { adminName: string }) {
  const [state, setState] = useState<AdminDashboardState | null>(null);
  const [tab, setTab] = useState<Tab>("live");
  const [settingsForm, setSettingsForm] = useState<FullSettings | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [notice, setNotice] = useState("");
  const [messageRecipient, setMessageRecipient] = useState<string | null>(null);
  const [directMessage, setDirectMessage] = useState("");

  const flash = useCallback((m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(""), 3000);
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/state", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setState(await r.json());
    } catch {
      /* offline — SSE fallback keeps going */
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void fetchState());
    // Polling fallback only; SSE (useLiveRefresh) drives live updates.
    const id = setInterval(fetchState, 60_000);
    return () => clearInterval(id);
  }, [fetchState]);

  useLiveRefresh(fetchState, 30_000);

  useEffect(() => {
    if (tab === "settings" && state && !settingsForm) {
      queueMicrotask(() => setSettingsForm(state.settings));
    }
  }, [tab, state, settingsForm]);

  async function saveSettings() {
    if (!settingsForm || busy) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const r = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "ذخیره ناموفق بود");
      else {
        setMsg("تنظیمات ذخیره شد ✓");
        fetchState();
      }
    } catch {
      setError("ارتباط برقرار نشد");
    } finally {
      setBusy(false);
    }
  }

  async function sendAnnouncement() {
    if (!announcement.trim() || busy) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const r = await fetch("/api/admin/announcement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: announcement }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "ارسال ناموفق بود");
      else {
        setMsg("اطلاعیه ارسال شد ✓");
        setAnnouncement("");
      }

    } catch {
      setError("ارتباط برقرار نشد");
    } finally {
      setBusy(false);
    }

  }

  async function sendDirectMessage() {
    if (!messageRecipient || !directMessage.trim() || busy) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const r = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: messageRecipient, message: directMessage }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "ارسال پیام ناموفق بود");
      else {
        setMsg("پیام مستقیم ارسال شد ✓");
        setDirectMessage("");
        setMessageRecipient(null);
      }
    } catch {
      setError("ارتباط برقرار نشد");
    } finally {
      setBusy(false);
    }
  }

  async function override(userId: string, action: "start" | "return" | "end-shift") {
    if (busy) return;
    if (action === "end-shift" && !confirm("شیفت این کاربر پایان یابد؟")) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "عملیات ناموفق بود");
      else fetchState();
    } catch {
      setError("ارتباط برقرار نشد");
    } finally {
      setBusy(false);
    }
  }

  async function breakControl(breakId: string, action: "extend" | "cancel") {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/break", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ breakId, action, minutes: 5 }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "عملیات ناموفق بود");
      else {
        flash(action === "extend" ? "استراحت ۵ دقیقه تمدید شد ✓" : "استراحت لغو شد ✓");
        fetchState();
      }
    } catch {
      setError("ارتباط برقرار نشد");
    } finally {
      setBusy(false);
    }
  }

  const buddyNameMap: Record<string, string> = {};
  if (state) {
    for (const e of state.employees) buddyNameMap[e.id] = e.name;
  }
  function buddyNames(ids: string[]): string {
    if (!ids.length) return "—";
    return ids.map((id) => buddyNameMap[id] ?? id).join("، ");
  }

  const noticeText = notice || error || msg;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 pb-8">
      <header className="glass-card flex items-center justify-between rounded-2xl px-4 py-3">
        <div>
          <h1 className="text-sm font-bold">پنل مدیریت — {adminName}</h1>
          <p className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
            <span className="inline-block size-1.5 animate-pulse rounded-full" style={{ background: "var(--working)" }} aria-hidden />
            وضعیت زنده‌ی تیم (Real-time)
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

      <nav className="glass-card flex gap-1 overflow-x-auto rounded-2xl p-1" role="tablist">
        {(
          [
            ["live", "زنده", Users],
            ["groups", "گروه‌ها", UsersRound],
            ["dinner", "برنامه شام", Coffee],
            ["reports", "گزارش‌ها", BarChart3],
            ["audit", "رخدادها", ScrollText],
            ["users", "کاربران", Users],
            ["settings", "تنظیمات", Settings],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-xs font-bold transition ${
              tab === key ? "text-white" : ""
            }`}
            style={tab === key ? { background: "var(--break)" } : { color: "var(--muted)" }}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </button>
        ))}
      </nav>

      {tab === "live" && (
        <>
          {!state ? (
            <div className="glass-card h-64 animate-pulse rounded-3xl" />
          ) : (
            <>
              <section className="grid grid-cols-4 gap-2">
                {[
                  { title: "در کار", value: state.stats.working, color: "var(--working)" },
                  { title: "استراحت", value: state.stats.onBreak, color: "var(--break)" },
                  { title: "در تماس", value: state.stats.onCall, color: "var(--warning)" },
                  { title: "تأخیر", value: state.stats.late, color: "var(--danger)" },
                ].map((s) => (
                  <div key={s.title} className="glass-card flex flex-col items-center gap-1 rounded-2xl p-3">
                    <span className="text-xl font-bold tabular-nums" style={{ color: s.color }}>
                      {formatPersianNumber(s.value)}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                      {s.title}
                    </span>
                  </div>
                ))}
              </section>

              <section className="glass-card flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
                <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--muted)" }}>
                  <Hourglass className="size-4" aria-hidden />
                  ظرفیت استراحت
                </span>
                <span className="text-sm font-bold tabular-nums" dir="ltr">
                  {formatPersianNumber(state.stats.activeBreaks)} / {formatPersianNumber(state.settings.maxConcurrentBreaks)}
                </span>
                <span
                  className="rounded-lg px-2 py-1 text-[11px] font-bold"
                  style={{
                    background: state.stats.remainingCapacity > 0 ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.12)",
                    color: state.stats.remainingCapacity > 0 ? "var(--working)" : "var(--danger)",
                  }}
                >
                  {state.stats.remainingCapacity > 0
                    ? `${formatPersianNumber(state.stats.remainingCapacity)} ظرفیت آزاد`
                    : "ظرفیت تکمیل"}
                </span>
              </section>

              {state.forecast.length > 0 && (
                <section className="glass-card rounded-3xl p-4">
                  <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                    <Clock className="size-4" aria-hidden />
                    پیش‌بینی یک ساعت آینده
                  </h2>
                  <ul className="flex flex-wrap gap-1.5">
                    {state.forecast.map((f) => (
                      <li
                        key={`${f.userId}:${f.scheduledStart}`}
                        className="rounded-lg px-2 py-1 text-[11px]"
                        style={{ background: "rgba(99,102,241,.1)", color: "var(--break)" }}
                      >
                        {f.name} — {formatPersianNumber(f.minutesAway)} دقیقه دیگر
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="glass-card rounded-3xl p-4">
                <h2 className="mb-3 text-sm font-bold">کارکنان</h2>
                {state.employees.length === 0 && (
                  <p className="py-4 text-center text-sm" style={{ color: "var(--muted)" }}>
                    کارمندی ثبت نشده است.
                  </p>
                )}
                <ul className="flex flex-col gap-2">
                  {state.employees.map((emp) => (
                    <li
                      key={emp.id}
                      className="flex flex-col gap-2 rounded-xl px-3 py-3"
                      style={{ background: "rgba(148,163,184,.08)" }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{emp.name}</p>
                          <p className="text-xs" dir="ltr" style={{ color: "var(--muted)" }}>
                            {emp.username}
                          </p>
                        </div>
                        <StatusBadge status={emp.status as UserStatus} label={emp.statusLabel} />
                        <span className="flex gap-1">
                          <button
                            onClick={() => setMessageRecipient(emp.id)}
                            disabled={busy}
                            className="flex size-8 items-center justify-center rounded-lg disabled:opacity-50"
                            style={{ background: "rgba(99,102,241,.12)", color: "var(--break)" }}
                            aria-label={`ارسال پیام به ${emp.name}`}
                            title="ارسال پیام"
                          >
                            <MessageSquare className="size-4" aria-hidden />
                          </button>
                          {emp.status === "WORKING" && (
                            <button
                              onClick={() => override(emp.id, "start")}
                              disabled={busy}
                              className="flex size-8 items-center justify-center rounded-lg text-white disabled:opacity-50"
                              style={{ background: "var(--break)" }}
                              aria-label={`شروع استراحت ${emp.name}`}
                              title="Override: شروع استراحت"
                            >
                              <Coffee className="size-4" aria-hidden />
                            </button>
                          )}
                          {(emp.status === "ON_BREAK" || emp.status === "LATE") && (
                            <>
                              <button
                                onClick={() => override(emp.id, "return")}
                                disabled={busy}
                                className="flex size-8 items-center justify-center rounded-lg text-white disabled:opacity-50"
                                style={{ background: "var(--working)" }}
                                aria-label={`بازگشت به کار ${emp.name}`}
                                title="Override: بازگشت به کار"
                              >
                                <Briefcase className="size-4" aria-hidden />
                              </button>
                              {emp.currentBreak && emp.currentBreak.kind !== "EMERGENCY" && (
                                <button
                                  onClick={() => breakControl(emp.currentBreak!.id, "extend")}
                                  disabled={busy}
                                  className="flex size-8 items-center justify-center rounded-lg disabled:opacity-50"
                                  style={{ background: "rgba(245,158,11,.12)", color: "var(--warning)" }}
                                  aria-label={`تمدید ۵ دقیقه‌ای استراحت ${emp.name}`}
                                  title="تمدید ۵ دقیقه"
                                >
                                  <Timer className="size-4" aria-hidden />
                                </button>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => override(emp.id, "end-shift")}
                            disabled={busy || emp.status === "OFFLINE"}
                            className="rounded-lg px-2 py-1.5 text-xs font-bold disabled:opacity-50"
                            style={{ background: "rgba(239,68,68,.1)", color: "var(--danger)" }}
                            title="Override: پایان شیفت"
                          >
                            پایان
                          </button>
                        </span>
                      </div>

                      <dl className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
                        <div>
                          <dt style={{ color: "var(--muted)" }}>شروع شیفت</dt>
                          <dd className="font-bold tabular-nums">{fmt(emp.shiftStartedAt, state.timezone)}</dd>
                        </div>
                        <div>
                          <dt style={{ color: "var(--muted)" }}>پایان شیفت</dt>
                          <dd className="font-bold tabular-nums">{fmt(emp.shiftEndedAt, state.timezone)}</dd>
                        </div>
                        <div>
                          <dt style={{ color: "var(--muted)" }}>Break بعدی</dt>
                          <dd className="font-bold tabular-nums">{fmt(emp.nextBreakAt, state.timezone)}</dd>
                        </div>
                        <div>
                          <dt style={{ color: "var(--muted)" }}>Countdown</dt>
                          <dd className="font-bold tabular-nums" dir="ltr">
                            {emp.countdownSeconds > 0 ? fmtCountdown(emp.countdownSeconds) : "—"}
                          </dd>
                        </div>
                        {emp.currentBreak && (
                          <>
                            <div>
                              <dt style={{ color: "var(--muted)" }}>شروع Break (واقعی)</dt>
                              <dd className="font-bold tabular-nums">{fmt(emp.currentBreak.actualStart, state.timezone)}</dd>
                            </div>
                            <div>
                              <dt style={{ color: "var(--muted)" }}>پایان Break</dt>
                              <dd className="font-bold tabular-nums">{fmt(emp.currentBreak.endsAt, state.timezone)}</dd>
                            </div>
                          </>
                        )}
                        <div>
                          <dt style={{ color: "var(--muted)" }}>مجموع Break</dt>
                          <dd className="font-bold">
                            {formatPersianNumber(emp.breakCount)} بار / {formatPersianNumber(emp.totalBreakMinutes)} دقیقه
                          </dd>
                        </div>
                        <div>
                          <dt style={{ color: "var(--muted)" }}>سکه / سطح</dt>
                          <dd className="font-bold">
                            {formatPersianNumber(emp.coins)} · Lv{formatPersianNumber(emp.level)}
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt style={{ color: "var(--muted)" }}>Buddy</dt>
                          <dd className="font-bold">{buddyNames(emp.buddies)}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              </section>
              {messageRecipient && (
                <section className="glass-card rounded-3xl p-4">
                  <h2 className="mb-2 text-sm font-bold">
                    پیام به {state.employees.find((e) => e.id === messageRecipient)?.name ?? "کارمند"}
                  </h2>
                  <textarea
                    value={directMessage}
                    onChange={(e) => setDirectMessage(e.target.value)}
                    maxLength={500}
                    className="min-h-20 w-full rounded-xl border border-slate-300/20 bg-transparent p-2 text-sm"
                    placeholder="پیام کوتاه مدیریتی..."
                  />
                  <div className="mt-2 flex gap-2">
                    <button onClick={sendDirectMessage} disabled={busy || !directMessage.trim()} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-50" style={{ background: "var(--break)" }}>ارسال پیام</button>
                    <button onClick={() => setMessageRecipient(null)} className="rounded-xl px-4 py-2 text-xs" style={{ background: "rgba(148,163,184,.1)" }}>انصراف</button>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {tab === "reports" && <ReportsTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "users" && <UsersTab onError={setError} onNotice={flash} />}
      {tab === "groups" && <GroupsTab timezone={state?.timezone} />}
      {tab === "dinner" && <DinnerTab />}

      {tab === "settings" && (
        <section className="glass-card flex flex-col gap-4 rounded-3xl p-5">
          <h2 className="text-sm font-bold">تنظیمات چرخه کار و استراحت</h2>
          {!settingsForm ? (
            <div className="h-40 animate-pulse rounded-2xl" />
          ) : (
            <>
              {SETTING_FIELDS.map(({ key, label, min }) => (
                <label key={key} className="flex items-center justify-between gap-3 text-sm font-medium">
                  {label}
                  <input
                    type="number"
                    dir="ltr"
                    min={min}
                    value={settingsForm[key] as number}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, [key]: Number(e.target.value) || min })
                    }
                    className="w-24 rounded-xl border px-3 py-2 text-center font-bold tabular-nums"
                    style={{ borderColor: "var(--border)" }}
                  />
                </label>
              ))}
              <label className="flex items-center justify-between gap-3 text-sm font-medium">
                منطقه زمانی (Timezone)
                <select
                  dir="ltr"
                  value={settingsForm.timezone}
                  onChange={(e) => setSettingsForm({ ...settingsForm, timezone: e.target.value })}
                  className="rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-3 rounded-2xl p-3" style={{ background: "rgba(99,102,241,.06)" }}>
                <h3 className="text-sm font-bold">Smart Break Buddy</h3>
                <label className="flex items-center justify-between gap-3 text-sm font-medium">
                  استراحت گروهی فعال باشد؟
                  <button
                    role="switch"
                    aria-checked={settingsForm.groupBreakEnabled}
                    onClick={() =>
                      setSettingsForm({ ...settingsForm, groupBreakEnabled: !settingsForm.groupBreakEnabled })
                    }
                    className="relative h-7 w-12 rounded-full transition"
                    style={{ background: settingsForm.groupBreakEnabled ? "var(--break)" : "rgba(148,163,184,.3)" }}
                  >
                    <span
                      className="absolute top-1 size-5 rounded-full bg-white transition-all"
                      style={{ [settingsForm.groupBreakEnabled ? "left" : "right"]: 4 } as React.CSSProperties}
                    />
                  </button>
                </label>
                <label className="flex items-center justify-between gap-3 text-sm font-medium">
                  حداکثر نسبت بار گروهی (٪)
                  <input
                    type="number"
                    dir="ltr"
                    min={10}
                    max={60}
                    step={5}
                    value={Math.round(settingsForm.maxGroupBreakLoadRatio * 100)}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        maxGroupBreakLoadRatio: (Number(e.target.value) || 30) / 100,
                      })
                    }
                    className="w-20 rounded-xl border px-3 py-2 text-center font-bold tabular-nums"
                    style={{ borderColor: "var(--border)" }}
                  />
                </label>
                <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                  سهم استراحت‌های هم‌زمان از کل آنلاین‌ها؛ با رسیدن به این سقف، شروع گروهی به زمان مناسب موکول می‌شود و استراحت عادی افراد دست نمی‌خورد.
                </p>
              </div>
              <button
                onClick={saveSettings}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-2xl py-3 font-bold text-white transition disabled:opacity-60"
                style={{ background: "var(--break)" }}
              >
                {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Settings className="size-5" aria-hidden />}
                ذخیره تنظیمات
              </button>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                تغییرات روی شیفت‌های فعال از استراحت بعدی اعمال می‌شود.
              </p>
              <div className="mt-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
                <h3 className="mb-2 text-sm font-bold">اطلاعیه به تیم</h3>
                <textarea
                  value={announcement}
                  onChange={(e) => setAnnouncement(e.target.value)}
                  placeholder="مثلاً: امروز حجم تماس‌ها بالاست؛ لطفاً استراحت‌ها را با هم هماهنگ کنید."
                  rows={3}
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}
                />
                <button
                  onClick={sendAnnouncement}
                  disabled={busy || !announcement.trim()}
                  className="mt-2 w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-60"
                  style={{ background: "var(--warning)" }}
                >
                  ارسال اطلاعیه
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {noticeText && (
        <div
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-lg"
          style={{
            background: error ? "var(--danger)" : "var(--working)",
            color: "#fff",
          }}
          role="alert"
        >
          {noticeText}
        </div>
      )}
    </main>
  );
}
