import type { UserStatus } from "@/types";

const CONFIG: Record<UserStatus, { label: string; bg: string; color: string }> = {
  WORKING: { label: "در حال کار", bg: "rgba(22,163,74,.1)", color: "var(--working)" },
  ON_BREAK: { label: "در استراحت", bg: "rgba(99,102,241,.1)", color: "var(--break)" },
  EMERGENCY: { label: "استراحت اضطراری", bg: "rgba(239,68,68,.1)", color: "var(--danger)" },
  ON_CALL: { label: "در تماس", bg: "rgba(245,158,11,.1)", color: "var(--warning)" },
  WAITING_BUDDY: { label: "انتظار برای گروه", bg: "rgba(168,85,247,.1)", color: "#a855f7" },
  LATE: { label: "تأخیر در بازگشت", bg: "rgba(239,68,68,.1)", color: "var(--danger)" },
  OFFLINE: { label: "آفلاین", bg: "rgba(100,116,139,.1)", color: "var(--muted)" },
};

export function StatusBadge({ status, label }: { status: UserStatus; label?: string }) {
  const c = CONFIG[status] ?? CONFIG.OFFLINE;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
      style={{ background: c.bg, color: c.color }}
    >
      <span className="size-2 rounded-full" style={{ background: c.color }} aria-hidden />
      {label ?? c.label}
    </span>
  );
}
