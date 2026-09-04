/**
 * Persian (Jalali) calendar conversion — dependency-free implementation of the
 * standard jalaali algorithm (Behrooz–Borkowski arithmetic).
 *
 * All Gregorian inputs/outputs use the LOCAL date components (year/month/day
 * numbers), never Date objects, so a change of machine timezone can never
 * shift the selected date by a day: "1405/06/15" always converts to
 * { gy: 2026, gm: 9, gd: 6 } regardless of TZ. Backend values remain
 * ISO "YYYY-MM-DD" / "YYYY-MM" strings (Gregorian, date-only).
 */

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy: number) {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(jump % 33, 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div((n % 33) + 3, 4);
  if (jump % 33 === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = (n + 1) % 33;
  if (leap < 0) leap += 33;
  leap = (leap - 1) % 4;
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * ((gm + 9) % 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div((j % 1461) / 4, 1) * 5 + 308;
  const gd = div((i % 153) / 5, 1) + 1;
  const gm = (div(i, 153) % 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** Jalali → Gregorian. All inputs are 1-based calendar day numbers. */
export function jalaliToGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) {
    throw new Error("مقادیر تاریخ باید عدد صحیح باشند");
  }
  if (jy < -61 || jy > 3177) throw new Error("سال شمسی خارج از محدوده است");
  if (jm < 1 || jm > 12) throw new Error("ماه شمسی باید بین ۱ تا ۱۲ باشد");
  if (jd < 1 || jd > jalaliMonthLength(jy, jm)) throw new Error("روز شمسی نامعتبر است");
  const r = jalCal(jy);
  return d2g(g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1);
}

/** Gregorian → Jalali. Inputs are LOCAL calendar components (no Date objects). */
export function gregorianToJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  if (!Number.isInteger(gy) || !Number.isInteger(gm) || !Number.isInteger(gd)) {
    throw new Error("مقادیر تاریخ باید عدد صحیح باشند");
  }
  if (gm < 1 || gm > 12 || gd < 1 || gd > 31) throw new Error("تاریخ میلادی نامعتبر است");
  return d2j(g2d(gy, gm, gd));
}

function d2j(jdn: number) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      const jm = 1 + div(k, 31);
      const jd = (k % 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    // Previous Jalali year (jy - 1 is leap iff jalCal(jy).leap === 1).
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  const jm = 7 + div(k, 30);
  const jd = (k % 30) + 1;
  return { jy, jm, jd };
}

/** Number of days in a Jalali month (1..12). */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return jalCal(jy).leap === 0 ? 30 : 29;
}

export const JALALI_MONTH_NAMES = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;

/** "2026-09-06" → "۱۵ شهریور ۱۴۰۵" */
export function formatJalaliDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const { jy, jm, jd } = d2j(g2d(Number(m[1]), Number(m[2]), Number(m[3])));
  return `${toPersianDigits(String(jd))} ${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(String(jy))}`;
}

/** "2026-09" → "شهریور ۱۴۰۵" */
export function formatJalaliMonth(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  const { jy, jm } = monthKeyToJalali(monthKey);
  return `${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(String(jy))}`;
}

/** "2026-09" → { jy: 1405, jm: 6 } — mid-month anchor avoids month-edge issues. */
export function monthKeyToJalali(monthKey: string): { jy: number; jm: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) throw new Error("کلید ماه نامعتبر است");
  const { jy, jm } = d2j(g2d(Number(m[1]), Number(m[2]), 15));
  return { jy, jm };
}

function toPersianDigits(value: string): string {
  return value.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Jalali (jy, jm, jd) → backend-standard ISO date "YYYY-MM-DD" (Gregorian). */
export function jalaliToIsoDate(jy: number, jm: number, jd: number): string {
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}

/** ISO "YYYY-MM-DD" (Gregorian, as stored by the backend) → Jalali components. */
export function isoDateToJalali(iso: string): { jy: number; jm: number; jd: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error("تاریخ نامعتبر است");
  return gregorianToJalali(Number(m[1]), Number(m[2]), Number(m[3]));
}

