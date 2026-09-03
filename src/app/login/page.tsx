"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Coffee, KeyRound, Loader2, LogIn, User } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        username: username.trim(),
        password,
        redirect: false,
      });
      if (res?.error) {
        setError("نام کاربری یا رمز عبور اشتباه است");
      } else {
        // Full navigation so the SW-cached shell refreshes with the new session.
        router.replace("/");
        router.refresh();
      }
    } catch {
      setError("خطای ارتباط با سرور. اتصال اینترنت را بررسی کنید.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm rounded-3xl p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div
            className="flex size-16 items-center justify-center rounded-2xl"
            style={{ background: "var(--break)", color: "#fff" }}
          >
            <Coffee className="size-8" aria-hidden />
          </div>
          <h1 className="text-xl font-bold">مدیریت استراحت مرکز تماس</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            تو فقط کارت رو انجام بده؛ حواسمون به زمان استراحتت هست.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-medium">
            نام کاربری
            <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: "var(--border)" }}>
              <User className="size-4 shrink-0" style={{ color: "var(--muted)" }} aria-hidden />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                dir="ltr"
                required
                className="w-full bg-transparent py-3 text-left outline-none"
              />
            </div>
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium">
            رمز عبور
            <div className="flex items-center gap-2 rounded-xl border px-3" style={{ borderColor: "var(--border)" }}>
              <KeyRound className="size-4 shrink-0" style={{ color: "var(--muted)" }} aria-hidden />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                dir="ltr"
                required
                className="w-full bg-transparent py-3 text-left outline-none"
              />
            </div>
          </label>

          {error && (
            <p role="alert" className="rounded-xl px-3 py-2 text-sm" style={{ background: "rgba(239,68,68,.08)", color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-xl py-3 font-bold text-white transition disabled:opacity-60"
            style={{ background: "var(--break)" }}
          >
            {loading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <LogIn className="size-5" aria-hidden />}
            ورود
          </button>
        </form>
      </div>
    </main>
  );
}
