import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function diffSeconds(later: Date, earlier: Date): number {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 1000));
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function diffMinutes(later: Date, earlier: Date): number {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 60_000));
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function countConcurrentBreaks(
  slots: Array<{ scheduledStart: Date; scheduledEnd: Date }>,
  windowStart: Date,
  windowEnd: Date,
): number {
  return slots.filter((s) => overlaps(s.scheduledStart, s.scheduledEnd, windowStart, windowEnd)).length;
}

export function formatPersianTime(date: Date | string, timeZone?: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(d);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes.toLocaleString("fa-IR")} دقیقه`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0
    ? `${h.toLocaleString("fa-IR")} ساعت`
    : `${h.toLocaleString("fa-IR")} ساعت و ${m.toLocaleString("fa-IR")} دقیقه`;
}

export function formatTimer(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatPersianNumber(value: number): string {
  return value.toLocaleString("fa-IR");
}
