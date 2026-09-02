"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, Loader2, UserPlus, X } from "lucide-react";
import { formatPersianNumber } from "@/lib/utils";

interface AdminUser {
  id: string;
  name: string;
  username: string;
  role: string;
  status: string;
  createdAt: string;
}

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: "کارمند",
  SUPERVISOR: "سرپرست",
  ADMIN: "مدیر",
};

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "EMPLOYEE", label: "کارمند" },
  { value: "SUPERVISOR", label: "سرپرست" },
  { value: "ADMIN", label: "مدیر" },
];

export function UsersTab({
  onError,
  onNotice,
}: {
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", username: "", password: "", role: "EMPLOYEE" });
  const [busy, setBusy] = useState(false);
  const [grantFor, setGrantFor] = useState<AdminUser | null>(null);
  const [grantAmount, setGrantAmount] = useState("50");
  const [grantReason, setGrantReason] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/users", { cache: "no-store" });
      if (r.ok) setUsers(await r.json());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function call(fn: () => Promise<Response>, successMsg?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      const d = await r.json().catch(() => ({}));
      if (!r.ok) onError(d.error ?? "عملیات ناموفق بود");
      else {
        if (successMsg) onNotice(successMsg);
        await load();
      }
    } catch {
      onError("ارتباط برقرار نشد");
    } finally {
      setBusy(false);
    }
  }

  const post = (url: string, body: unknown, method = "POST") =>
    fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function addUser() {
    await call(() => post("/api/admin/users", newUser), `کاربر ${newUser.name} ایجاد شد ✓`);
    setNewUser({ name: "", username: "", password: "", role: "EMPLOYEE" });
    setShowAdd(false);
  }

  async function changeRole(u: AdminUser, role: string) {
    if (role === u.role) return;
    await call(() => post("/api/admin/users", { id: u.id, role }, "PATCH"), `نقش ${u.name} تغییر کرد ✓`);
  }

  async function grantCoins() {
    if (!grantFor) return;
    const amount = Number(grantAmount);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000) {
      onError("مقدار باید عددی بین ۱۰۰۰- تا ۱۰۰۰ (غیرصفر) باشد");
      return;
    }
    await call(
      () => post("/api/admin/grant", { userId: grantFor.id, amount, reason: grantReason.trim() || "MANUAL" }),
      `${formatPersianNumber(Math.abs(amount))} سکه برای ${grantFor.name} ثبت شد ✓`,
    );
    setGrantFor(null);
    setGrantReason("");
    setGrantAmount("50");
  }

  async function deleteUser(u: AdminUser) {
    if (!confirm(`کاربر «${u.username}» حذف شود؟`)) return;
    await call(() => fetch(`/api/admin/users?id=${u.id}`, { method: "DELETE" }), `کاربر ${u.username} حذف شد`);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">مدیریت کاربران و نقش‌ها</h2>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
          style={{ background: "var(--working)" }}
        >
          {showAdd ? <X className="size-4" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
          {showAdd ? "بستن" : "کاربر جدید"}
        </button>
      </div>

      {showAdd && (
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
            placeholder="نام کاربری (انگلیسی)"
            dir="ltr"
            required
            pattern="[a-zA-Z0-9_.]{3,30}"
            className="rounded-xl border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)" }}
          />
          <input
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            placeholder="رمز عبور (حداقل ۶ کاراکتر)"
            dir="ltr"
            required
            minLength={6}
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
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
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
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5"
              style={{ background: "rgba(148,163,184,.08)" }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{u.name}</p>
                <p className="text-xs" dir="ltr" style={{ color: "var(--muted)" }}>
                  {u.username} · {ROLE_LABEL[u.role] ?? u.role}
                </p>
              </div>
              <span className="flex items-center gap-1.5">
                <select
                  value={u.role}
                  onChange={(e) => changeRole(u, e.target.value)}
                  disabled={busy}
                  aria-label={`نقش ${u.name}`}
                  className="rounded-lg border px-2 py-1.5 text-xs"
                  style={{ borderColor: "var(--border)" }}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setGrantFor(u)}
                  disabled={busy}
                  className="flex size-8 items-center justify-center rounded-lg disabled:opacity-50"
                  style={{ background: "rgba(245,158,11,.12)", color: "var(--warning)" }}
                  aria-label={`اعطای سکه به ${u.name}`}
                  title="اعطای/کسر سکه"
                >
                  <Coins className="size-4" aria-hidden />
                </button>
                {u.role !== "ADMIN" && (
                  <button
                    onClick={() => deleteUser(u)}
                    disabled={busy}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-bold"
                    style={{ background: "rgba(239,68,68,.1)", color: "var(--danger)" }}
                  >
                    حذف
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {grantFor && (
        <div className="glass-card flex flex-col gap-2 rounded-2xl p-4">
          <h3 className="text-sm font-bold">اعطای/کسر سکه برای {grantFor.name}</h3>
          <div className="flex gap-2">
            <input
              type="number"
              dir="ltr"
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              className="w-28 rounded-xl border px-3 py-2 text-center font-bold tabular-nums"
              style={{ borderColor: "var(--border)" }}
            />
            <input
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              placeholder="دلیل (مثلاً پرفورمنس امروز)"
              className="flex-1 rounded-xl border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
            />
          </div>
          <p className="text-[11px]" style={{ color: "var(--muted)" }}>
            عدد مثبت = اعطا، عدد منفی = کسر. حداکثر ±۱۰۰۰.
          </p>
          <span className="flex gap-2">
            <button
              onClick={grantCoins}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-60"
              style={{ background: "var(--warning)" }}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              ثبت
            </button>
            <button
              onClick={() => setGrantFor(null)}
              className="rounded-xl px-4 py-2.5 text-sm font-bold"
              style={{ background: "rgba(100,116,139,.1)" }}
            >
              انصراف
            </button>
          </span>
        </div>
      )}
    </section>
  );
}
