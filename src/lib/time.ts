/**
 * Company-timezone helpers. All business logic runs on UTC server time;
 * these helpers only bucket/label instants by the COMPANY timezone from
 * Settings (default Asia/Tehran) — never by the server's or client's local zone.
 */

const dayKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();
const hourFormatterCache = new Map<string, Intl.DateTimeFormat>();

function safeZone(timeZone?: string): string {
  const tz = timeZone || "Asia/Tehran";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "Asia/Tehran";
  }
}

function dayKeyFormatter(timeZone?: string): Intl.DateTimeFormat {
  const tz = safeZone(timeZone);
  let f = dayKeyFormatterCache.get(tz);
  if (!f) {
    // en-CA gives YYYY-MM-DD
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayKeyFormatterCache.set(tz, f);
  }
  return f;
}

function hourFormatter(timeZone?: string): Intl.DateTimeFormat {
  const tz = safeZone(timeZone);
  let f = hourFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    });
    hourFormatterCache.set(tz, f);
  }
  return f;
}

/** Stable day key (YYYY-MM-DD) of an instant in the company timezone. */
export function companyDayKey(date: Date, timeZone?: string): string {
  return dayKeyFormatter(timeZone).format(date);
}

/** Hour (0-23) of an instant in the company timezone. */
export function companyHour(date: Date, timeZone?: string): number {
  return Number(hourFormatter(timeZone).format(date)) % 24;
}

/** First instant of the company "today" (binary-searched, DST-safe, minute precision). */
export function startOfCompanyDay(timeZone?: string, now = new Date()): Date {
  const key = companyDayKey(now, timeZone);
  const [y, m, d] = key.split("-").map(Number);
  let lo = Date.UTC(y, m - 1, d) - 24 * 3600_000; // surely previous company day
  let hi = Date.UTC(y, m - 1, d) + 48 * 3600_000; // surely inside/after
  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (companyDayKey(new Date(mid), timeZone) === key) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

export function daysAgoInCompanyZone(days: number, timeZone?: string, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 3600 * 1000);
}
