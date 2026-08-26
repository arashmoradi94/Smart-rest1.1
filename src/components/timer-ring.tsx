"use client";

import { formatTimer } from "@/lib/utils";

export function TimerRing({
  seconds,
  totalSeconds,
  color,
  label,
  pulsing = false,
}: {
  seconds: number;
  totalSeconds: number;
  color: string;
  label: string;
  pulsing?: boolean;
}) {
  const pct = totalSeconds > 0 ? Math.min(100, ((totalSeconds - seconds) / totalSeconds) * 100) : 0;
  return (
    <div
      className={`timer-ring relative mx-auto flex size-56 items-center justify-center rounded-full sm:size-64${pulsing ? " animate-pulse-soft" : ""}`}
      style={{ "--progress": `${pct}%`, "--ring-color": color } as React.CSSProperties}
      role="timer"
      aria-label={`${label}: ${formatTimer(seconds)}`}
    >
      <div
        className="flex size-48 flex-col items-center justify-center gap-1 rounded-full sm:size-56"
        style={{ background: "var(--background)" }}
      >
        <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
          {label}
        </span>
        <span className="text-4xl font-bold tabular-nums sm:text-5xl" dir="ltr" style={{ color }}>
          {formatTimer(seconds)}
        </span>
      </div>
    </div>
  );
}
