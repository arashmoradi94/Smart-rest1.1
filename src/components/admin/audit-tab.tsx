"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { formatPersianNumber } from "@/lib/utils";
import type { AuditRow } from "@/types";

/** Persian labels + tone for known audit actions. */
const ACTION_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "info" }> = {
  SHIFT_START: { label: "شروع شیفت", tone: "ok" },
  SHIFT_END: { label: "پایان شیفت", tone: "info" },
  BREAK_START: { label: "شروع استراحت", tone: "ok" },
  BREAK_RETURN: { label: "بازگشت به کار", tone: "ok" },
  EXTEND_BREAK: { label: "تمدید استراحت", tone: "warn" },
  CANCEL_BREAK: { label: "لغو استراحت", tone: "danger" },
  LEAVE_GROUP: { label: "خروج از گروه", tone: "info" },
  OVERRIDE_BREAK_START: { label: "Override: شروع استراحت", tone: "warn" },
  OVERRIDE_BREAK_RETURN: { label: "Override: بازگشت", tone: "warn" },
  OVERRIDE_END_SHIFT: { label: "Override: پایان شیفت", tone: "danger" },
  UPDATE_SETTINGS: { label: "تغییر تنظیمات", tone: "warn" },
  CREATE_USER: { label: "ایجاد کاربر", tone: "info" },
  DELETE_USER: { label: "حذف کاربر", tone: "danger" },
  UPDATE_ROLE: { label: "تغییر نقش", tone: "warn" },
  GRANT_COINS: { label: "اعطای سکه", tone: "ok" },
  DEDUCT_COINS: { label: "کسر سکه", tone: "danger" },
  REWARD_REDEEM: { label: "دریافت پاداش", tone: "ok" },
  CREATE_REWARD: { label: "ایجاد پاداش", tone: "info" },
  ENABLE_REWARD: { label: "فعال‌سازی پاداش", tone: "info" },
  DISABLE_REWARD: { label: "غیرفعال‌سازی پاداش", tone: "warn" },
  ANNOUNCEMENT: { label: "اطلاعیه", tone: "info" },
  BUDDY_REQUEST: { label: "درخواست Buddy", tone: "info" },
  BUDDY_RESPONSE: { label: "پاسخ Buddy", tone: "info" },
  BUDDY_REMOVE: { label: "حذف Buddy", tone: "info" },
  ADMIN_SYNC_BUDDY: { label: "Buddy اجباری", tone: "warn" },
  ADMIN_UNSYNC_BUDDY: { label: "حذف Buddy اجباری", tone: "warn" },
  TOGGLE_CALL_STATUS: { label: "وضعیت تماس", tone: "info" },
  SET_CALL_STATUS: { label: "وضعیت تماس (مدیر)", tone: "warn" },
  PUSH_SUBSCRIBE: { label: "اشتراک نوتیف", tone: "info" },
  PUSH_UNSUBSCRIBE: { label: "لغو اشتراک نوتیف", tone: "info" },
  LOGIN_FAILED: { label: "ورود ناموفق", tone: "danger" },
};

const TONE_COLOR: Record<string, string> = {
  ok: "var(--working)",
  warn: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--muted)",
};

function fmt(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function AuditTab() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/audit?limit=200", { cache: "no-store" });
      if (r.ok) setRows(await r.json());
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const filtered = (rows ?? []).filter((r) => {
    if (!filter) return true;
    const meta = ACTION_LABEL[r.action];
    return (
      r.action.includes(filter.toUpperCase()) ||
      (meta?.label ?? "").includes(filter) ||
      r.userName.includes(filter) ||
      (r.details ?? "").includes(filter)
    );
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <ScrollText className="size-4" aria-hidden />
          گزارش رخدادها (Audit Log)
        </h2>
        <button
          onClick={load}
          className="rounded-xl px-3 py-1.5 text-xs font-bold"
          style={{ background: "rgba(100,116,139,.1)", color: "var(--muted)" }}
        >
          به‌روزرسانی
        </button>
      </div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="جستجو در رخدادها، نام کاربر یا جزئیات…"
        className="rounded-xl border px-3 py-2 text-sm"
        style={{ borderColor: "var(--border)" }}
      />
      {!rows ? (
        <div className="glass-card h-64 animate-pulse rounded-3xl" />
      ) : filtered.length === 0 ? (
        <p className="glass-card rounded-3xl py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
          رخدادی یافت نشد.
        </p>
      ) : (
        <ul className="glass-card flex max-h-[60vh] flex-col gap-1 overflow-y-auto rounded-3xl p-3">
          {filtered.map((r) => {
            const meta = ACTION_LABEL[r.action] ?? { label: r.action, tone: "info" as const };
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs"
                style={{ background: "rgba(148,163,184,.06)" }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5">
                    <b style={{ color: TONE_COLOR[meta.tone] }}>{meta.label}</b>
                    <span className="truncate font-bold">{r.userName}</span>
                  </span>
                  {r.details && (
                    <span className="truncate" dir="auto" style={{ color: "var(--muted)" }}>
                      {r.details}
                    </span>
                  )}
                </span>
                <time className="shrink-0 tabular-nums" style={{ color: "var(--muted)" }}>
                  {fmt(r.createdAt)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-center text-[10px]" style={{ color: "var(--muted)" }}>
        {formatPersianNumber(filtered.length)} رخداد نمایش داده می‌شود
      </p>
    </section>
  );
}
