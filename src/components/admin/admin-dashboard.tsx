"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Briefcase,
  Coffee,
  Loader2,
  LogOut,
  Settings,
  UserPlus,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { formatPersianNumber } from "@/lib/utils";
import type { AdminDashboardState, FullSettings, UserStatus } from "@/types";

interface AdminUser {
  id: string;
  name: string;
  username: string;
  role: string;
  status: string;
  createdAt: string;
}

function StatCard({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <div className="glass-card flex flex-col items-center gap-1 rounded-2xl p-4">
      <span className="text-2xl font-bold tabular-nums" style={{ color }}>
        {formatPersianNumber(value)}
      </span>
      <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
        {title}
      </span>
    </div>
  );
}

const SETTING_FIELDS: Array<{ key: keyof FullSettings; label: string; min: number }> = [
  { key: "workDurationMinutes", label: "مدت کار (دقیقه)", min: 10 },
  { key: "breakDurationMinutes", label: "مدت استراحت (دقیقه)", min: 5 },
  { key: "maxConcurrentBreaks", label: "حداکثر استراحت همزمان", min: 1 },
  { key: "earlyNotificationMinutes", label: "اعلان قبل از استراحت (دقیقه)", min: 1 },
  { key: "endNotificationMinutes", label: "هشدار پایان استراحت (دقیقه)", min: 1 },
];

export function AdminDashboard({ adminName }: { adminName: string }) {
  const [state, setState] = useState<AdminDashboardState | null>(null);
  const [tab, setTab] = useState<"live" | "settings" | "users">("live");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [settingsForm, setSettingsForm] = useState<FullSettings | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", username: "", password: "", role: "EMPLOYEE" });

  const fetchState = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/state", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setState(await r.json());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 15_000);
    const onVisible = () => document.visibilityState === "visible" && fetchState();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchState]);

  const fetchUsers = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/users", { cache: "no-store" });
      if (r.ok) setUsers(await r.json());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    if (tab === "users" && !users) fetchUsers();
    if (tab === "settings" && state && !settingsForm) setSettingsForm(state.settings);
  }, [tab, users, state, settingsForm, fetchUsers]);

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

  async function addUser() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "ایجاد کاربر ناموفق بود");
      else {
        setMsg(`کاربر ${newUser.name} ایجاد شد ✓`);
        setNewUser({ name: "", username: "", password: "", role: "EMPLOYEE" });
        setShowAddUser(false);
        fetchUsers();
        fetchState();
      }
    } catch {
      setError("ارتباط برقرار نشد");
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(id: string, username: string) {
    if (!confirm(`کاربر «${username}» حذف شود؟`)) return;
    try {
      const r = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "حذف ناموفق بود");
      else {
        setMsg(`کاربر ${username} حذف شد`);
        fetchUsers();
        fetchState();
      }
    } catch {
      setError("ارتباط برقرار نشد");
    }
  }

  async function override(userId: string, action: "start" | "return") {
    if (busy) return;
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

  const notice = error || msg;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4 pb-8">
      <header className="glass-card flex items-center justify-between rounded-2xl px-4 py-3">
        <div>
          <h1 className="text-sm font-bold">پنل مدیریت — {adminName}</h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            وضعیت لحظه‌ای تیم
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

      <nav className="glass-card flex gap-1 rounded-2xl p-1" role="tablist">
        {(
          [
            ["live", "وضعیت لحظه‌ای", Users],
            ["settings", "تنظیمات", Settings],
            ["users", "کاربران", UserPlus],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition ${
              tab === key ? "text-white" : ""
            }`}
            style={tab === key ? { background: "var(--break)" } : { color: "var(--muted)" }}
          >
            <Icon className="size-4" aria-hidden />
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
              <section className="grid grid-cols-5 gap-2">
                <StatCard title="کل" value={state.stats.total} color="var(--foreground)" />
                <StatCard title="کار" value={state.stats.working} color="var(--working)" />
                <StatCard title="استراحت" value={state.stats.onBreak} color="var(--break)" />
                <StatCard title="تأخیر" value={state.stats.late} color="var(--danger)" />
                <StatCard title="آفلاین" value={state.stats.offline} color="var(--muted)" />
              </section>

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
                      className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5"
                      style={{ background: "rgba(148,163,184,.08)" }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{emp.name}</p>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                          {emp.status === "ON_BREAK" || emp.status === "LATE"
                            ? `پایان استراحت: ${emp.breakInfo}`
                            : emp.breakInfo !== "—"
                              ? `استراحت بعدی: ${emp.breakInfo}`
                              : "بدون شیفت فعال"}
                        </p>
                      </div>
                      {emp.delayMinutes > 0 && (
                        <span className="text-xs font-bold" style={{ color: "var(--danger)" }}>
                          {formatPersianNumber(emp.delayMinutes)} دقیقه تأخیر
                        </span>
                      )}
                      <StatusBadge status={emp.status as UserStatus} label={emp.statusLabel} />
                      {emp.status !== "OFFLINE" && (
                        <span className="flex gap-1">
                          {emp.status === "WORKING" ? (
                            <button
                              onClick={() => override(emp.id, "start")}
                              disabled={busy}
                              className="flex size-8 items-center justify-center rounded-lg text-white disabled:opacity-50"
                              style={{ background: "var(--break)" }}
                              aria-label={`شروع استراحت ${emp.name}`}
                              title="شروع استراحت (مدیریت)"
                            >
                              <Coffee className="size-4" aria-hidden />
                            </button>
                          ) : (
                            <button
                              onClick={() => override(emp.id, "return")}
                              disabled={busy}
                              className="flex size-8 items-center justify-center rounded-lg text-white disabled:opacity-50"
                              style={{ background: "var(--working)" }}
                              aria-label={`بازگشت به کار ${emp.name}`}
                              title="بازگشت به کار (مدیریت)"
                            >
                              <Briefcase className="size-4" aria-hidden />
                            </button>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}

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
                    value={settingsForm[key]}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, [key]: Number(e.target.value) || min })
                    }
                    className="w-24 rounded-xl border px-3 py-2 text-center font-bold tabular-nums"
                    style={{ borderColor: "var(--border)" }}
                  />
                </label>
              ))}
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
            </>
          )}
        </section>
      )}

      {tab === "users" && (
        <section className="glass-card flex flex-col gap-3 rounded-3xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">مدیریت کاربران</h2>
            <button
              onClick={() => setShowAddUser((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
              style={{ background: "var(--working)" }}
            >
              {showAddUser ? <X className="size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
              {showAddUser ? "بستن" : "کاربر جدید"}
            </button>
          </div>

          {showAddUser && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addUser();
              }}
              className="flex flex-col gap-2 rounded-2xl p-3"
              style={{ background: "rgba(148,163,184,.08)" }}
            >
              <input
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="نام کامل"
                required
                className="rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <input
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="نام کاربری"
                dir="ltr"
                required
                className="rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="رمز عبور"
                dir="ltr"
                required
                className="rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
              <label className="flex items-center justify-between text-sm font-medium">
                نقش
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="rounded-xl border px-3 py-2"
                  style={{ borderColor: "var(--border)" }}
                >
                  <option value="EMPLOYEE">کارمند</option>
                  <option value="ADMIN">مدیر</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl py-2.5 font-bold text-white disabled:opacity-60"
                style={{ background: "var(--break)" }}
              >
                ایجاد کاربر
              </button>
            </form>
          )}

          {!users ? (
            <div className="h-40 animate-pulse rounded-2xl" />
          ) : (
            <ul className="flex flex-col gap-2">
              {users.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5"
                  style={{ background: "rgba(148,163,184,.08)" }}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{u.name}</p>
                    <p className="text-xs" dir="ltr" style={{ color: "var(--muted)" }}>
                      {u.username} · {u.role === "ADMIN" ? "مدیر" : "کارمند"}
                    </p>
                  </div>
                  {u.role !== "ADMIN" && (
                    <button
                      onClick={() => deleteUser(u.id, u.username)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-bold"
                      style={{ background: "rgba(239,68,68,.1)", color: "var(--danger)" }}
                    >
                      حذف
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {notice && (
        <div
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-lg"
          style={{
            background: error ? "var(--danger)" : "var(--working)",
            color: "#fff",
          }}
          role="alert"
        >
          {notice}
        </div>
      )}
    </main>
  );
}
