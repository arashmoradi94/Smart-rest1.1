"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, Save, UserRound } from "lucide-react";

type Profile = { name: string; username: string; role: string; status: string };

const roleLabels: Record<string, string> = {
  EMPLOYEE: "کارمند",
  SUPERVISOR: "سرپرست",
  ADMIN: "مدیر",
};

const statusLabels: Record<string, string> = {
  OFFLINE: "آفلاین",
  WORKING: "در حال کار",
  ON_BREAK: "در استراحت",
  ON_CALL: "در تماس",
  LATE: "تأخیر در بازگشت",
};

export function ProfilePanel() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/profile", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const data = (await response.json()) as Profile;
    setProfile(data);
    setName(data.name);
  }

  useEffect(() => {
    queueMicrotask(() => void load().catch(() => setError("اطلاعات پروفایل بارگذاری نشد")));
  }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "ذخیره پروفایل ناموفق بود");
      else {
        setProfile(data);
        setName(data.name);
        setMessage("پروفایل ذخیره شد");
      }
    } catch {
      setError("ارتباط با سرور برقرار نشد");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "تغییر رمز عبور ناموفق بود");
      else {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setMessage("رمز عبور تغییر کرد؛ برای ادامه دوباره وارد شوید");
      }
    } catch {
      setError("ارتباط با سرور برقرار نشد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="profile-panel" className="glass-card flex scroll-mt-4 flex-col gap-4 rounded-3xl p-5" aria-labelledby="profile-heading">
      <div className="flex items-center gap-2">
        <UserRound className="size-5" style={{ color: "var(--break)" }} aria-hidden />
        <h2 id="profile-heading" className="font-bold">پروفایل من</h2>
      </div>
      {!profile ? (
        <div className="h-32 animate-pulse rounded-2xl" style={{ background: "var(--surface-soft)" }} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl p-3" style={{ background: "var(--surface-soft)" }}>
              <dt className="text-xs" style={{ color: "var(--muted)" }}>نام کاربری</dt>
              <dd className="mt-1 font-bold" dir="ltr">{profile.username}</dd>
            </div>
            <div className="rounded-xl p-3" style={{ background: "var(--surface-soft)" }}>
              <dt className="text-xs" style={{ color: "var(--muted)" }}>نقش</dt>
              <dd className="mt-1 font-bold">{roleLabels[profile.role] ?? profile.role}</dd>
            </div>
            <div className="rounded-xl p-3" style={{ background: "var(--surface-soft)" }}>
              <dt className="text-xs" style={{ color: "var(--muted)" }}>وضعیت</dt>
              <dd className="mt-1 font-bold">{statusLabels[profile.status] ?? profile.status}</dd>
            </div>
          </dl>

          <form onSubmit={saveProfile} className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="profile-name">نام نمایشی</label>
            <div className="flex gap-2">
              <input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={60}
                required
                className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 py-2.5"
                style={{ borderColor: "var(--border)" }}
              />
              <button type="submit" disabled={busy} className="flex items-center gap-1 rounded-xl px-3 font-bold text-white disabled:opacity-60" style={{ background: "var(--break)" }}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                ذخیره
              </button>
            </div>
          </form>

          <form onSubmit={changePassword} className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <KeyRound className="size-4" aria-hidden />
              تغییر رمز عبور
            </h3>
            {[
              ["current-password", "رمز عبور فعلی", currentPassword, setCurrentPassword],
              ["new-password", "رمز عبور جدید (حداقل ۸ کاراکتر)", newPassword, setNewPassword],
              ["new-password", "تکرار رمز عبور جدید", confirmPassword, setConfirmPassword],
            ].map(([autocomplete, label, value, setter]) => (
              <label key={label as string} className="flex flex-col gap-1 text-sm font-medium">
                {label as string}
                <input
                  type="password"
                  autoComplete={autocomplete as string}
                  value={value as string}
                  onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                  required
                  maxLength={72}
                  className="rounded-xl border bg-transparent px-3 py-2.5"
                  style={{ borderColor: "var(--border)" }}
                />
              </label>
            ))}
            <button type="submit" disabled={busy} className="flex items-center justify-center gap-2 rounded-xl py-2.5 font-bold text-white disabled:opacity-60" style={{ background: "var(--foreground)" }}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              تغییر رمز عبور
            </button>
          </form>
        </>
      )}
      {(message || error) && <p role={error ? "alert" : "status"} className="rounded-xl px-3 py-2 text-sm" style={{ background: error ? "rgba(239,68,68,.1)" : "rgba(34,197,94,.1)", color: error ? "var(--danger)" : "var(--working)" }}>{error || message}</p>}
    </section>
  );
}
