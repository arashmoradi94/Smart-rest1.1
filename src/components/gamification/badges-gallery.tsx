"use client";

import { useState } from "react";
import { formatPersianNumber } from "@/lib/utils";
import type { BadgeView } from "@/types";

export function BadgesGallery({ badges }: { badges: BadgeView[] }) {
  const [open, setOpen] = useState(false);
  const earned = badges.filter((b) => b.earned).length;
  if (badges.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-bold"
        style={{ background: "rgba(245,158,11,.1)", color: "var(--warning)" }}
        aria-expanded={open}
      >
        <span>🏅 نشان‌ها</span>
        <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
          {formatPersianNumber(earned)} از {formatPersianNumber(badges.length)}
          {open ? " ▲" : " ▼"}
        </span>
      </button>
      {open && (
        <ul className="mt-2 grid grid-cols-2 gap-2">
          {badges.map((b) => (
            <li
              key={b.key}
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
              style={{
                background: b.earned ? "rgba(245,158,11,.1)" : "rgba(148,163,184,.06)",
                opacity: b.earned ? 1 : 0.55,
              }}
            >
              <span className="text-lg" aria-hidden>
                {b.icon}
              </span>
              <span className="font-medium" style={{ color: b.earned ? undefined : "var(--muted)" }}>
                {b.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
