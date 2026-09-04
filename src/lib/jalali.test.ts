import { describe, expect, it } from "vitest";
import {
  formatJalaliDate,
  gregorianToJalali,
  isoDateToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  jalaliToIsoDate,
  monthKeyToJalali,
} from "@/lib/jalali";

/**
 * Jalali ↔ Gregorian conversion (acceptance item 5). The implementation works
 * on plain calendar NUMBERS, never on Date objects, so the machine timezone
 * can never shift a chosen date by a day.
 */
describe("Jalali ↔ Gregorian conversion", () => {
  it("round-trips a normal date", () => {
    // 1405/06/15 == 2026-09-06
    expect(jalaliToGregorian(1405, 6, 15)).toEqual({ gy: 2026, gm: 9, gd: 6 });
    expect(gregorianToJalali(2026, 9, 6)).toEqual({ jy: 1405, jm: 6, jd: 15 });
  });

  it("first day of a month converts exactly", () => {
    // 1405/07/01 == 2026-09-23 (Mehr starts)
    const g = jalaliToGregorian(1405, 7, 1);
    const j = gregorianToJalali(g.gy, g.gm, g.gd);
    expect(j).toEqual({ jy: 1405, jm: 7, jd: 1 });
  });

  it("last day of a month → first day of the next month is consecutive", () => {
    // Shahrivar (6) has 31 days
    expect(jalaliMonthLength(1405, 6)).toBe(31);
    const last = jalaliToGregorian(1405, 6, 31);
    expect(last).toEqual({ gy: 2026, gm: 9, gd: 22 });
    const next = jalaliToGregorian(1405, 7, 1);
    expect(next).toEqual({ gy: 2026, gm: 9, gd: 23 });
    // going back: 1405/06/31 + 1 == 1405/07/01
    expect(gregorianToJalali(2026, 9, 23)).toEqual({ jy: 1405, jm: 7, jd: 1 });
  });

  it("Esfand length follows the leap year (1403 leap → 30 days)", () => {
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
  });

  it("leap-year Esfand 30 round-trips", () => {
    const g = jalaliToGregorian(1403, 12, 30);
    expect(gregorianToJalali(g.gy, g.gm, g.gd)).toEqual({ jy: 1403, jm: 12, jd: 30 });
  });

  it("round-trips a sweep of dates without drift", () => {
    for (let jy = 1403; jy <= 1406; jy += 1) {
      for (let jm = 1; jm <= 12; jm += 1) {
        for (const jd of [1, 15, jalaliMonthLength(jy, jm)]) {
          const g = jalaliToGregorian(jy, jm, jd);
          expect(gregorianToJalali(g.gy, g.gm, g.gd)).toEqual({ jy, jm, jd });
        }
      }
    }
  });

  it("monthKeyToJalali anchors mid-month so edges can never shift the month", () => {
    expect(monthKeyToJalali("2026-09")).toEqual({ jy: 1405, jm: 6 });
    expect(monthKeyToJalali("2026-03")).toEqual({ jy: 1404, jm: 12 }); // month boundary
    expect(monthKeyToJalali("2026-01")).toEqual({ jy: 1404, jm: 10 });
  });

  it("formatJalaliDate renders Persian digits and Persian month names", () => {
    expect(formatJalaliDate("2026-09-06")).toBe("۱۵ شهریور ۱۴۰۵");
    expect(formatJalaliDate("2026-03-21")).toBe("۱ فروردین ۱۴۰۵");
    expect(formatJalaliDate("not-a-date")).toBe("not-a-date");
  });

  it("rejects invalid inputs instead of shifting them", () => {
    expect(() => jalaliToGregorian(1405, 13, 1)).toThrow();
    expect(() => jalaliToGregorian(1405, 6, 32)).toThrow();
    expect(() => gregorianToJalali(2026, 13, 1)).toThrow();
    expect(() => gregorianToJalali(2026, 9, 0)).toThrow();
  });
});

/**
 * Backend-standard ISO date mapping (acceptance item 5): the picked Jalali
 * day/month/year converts exactly to the Gregorian "YYYY-MM-DD" the backend
 * stores, and reading it back after a refresh shows the same Jalali date.
 * The helpers work on calendar NUMBERS only — no Date objects — so no machine
 * timezone can ever shift the chosen date by a day.
 */
describe("Jalali ↔ ISO date (backend standard value)", () => {
  it("converts a normal date to the ISO value the backend stores", () => {
    expect(jalaliToIsoDate(1405, 6, 15)).toBe("2026-09-06");
    expect(isoDateToJalali("2026-09-06")).toEqual({ jy: 1405, jm: 6, jd: 15 });
  });

  it("handles the FIRST day of a month and the LAST day exactly", () => {
    // 1405/07/01 (Mehr begins) is 2026-09-23; the day before is Shahrivar 31
    expect(jalaliToIsoDate(1405, 7, 1)).toBe("2026-09-23");
    expect(jalaliToIsoDate(1405, 6, 31)).toBe("2026-09-22");
    expect(isoDateToJalali("2026-09-22")).toEqual({ jy: 1405, jm: 6, jd: 31 });
  });

  it("leap-year Esfand 30 maps without drift", () => {
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    const iso = jalaliToIsoDate(1403, 12, 30);
    expect(isoDateToJalali(iso)).toEqual({ jy: 1403, jm: 12, jd: 30 });
  });

  it("switching months stays exact (month boundary both directions)", () => {
    // 1404/12/29 (last day of non-leap 1404) ↔ 2026-03-20, and 1405/01/01 (Nowruz) ↔ 2026-03-21
    expect(jalaliToIsoDate(1404, 12, 29)).toBe("2026-03-20");
    expect(jalaliToIsoDate(1405, 1, 1)).toBe("2026-03-21");
    expect(isoDateToJalali("2026-03-20")).toEqual({ jy: 1404, jm: 12, jd: 29 });
    expect(isoDateToJalali("2026-03-21")).toEqual({ jy: 1405, jm: 1, jd: 1 });
  });

  it("is refresh-stable: save → reload round-trips the SAME Jalali date", () => {
    for (const [jy, jm, jd] of [
      [1405, 6, 1],
      [1405, 6, 31],
      [1405, 7, 1],
      [1404, 12, 29],
      [1403, 12, 30],
    ] as const) {
      expect(isoDateToJalali(jalaliToIsoDate(jy, jm, jd))).toEqual({ jy, jm, jd });
    }
  });

  it("rejects non-ISO input instead of guessing", () => {
    expect(() => isoDateToJalali("2026-9-6")).toThrow();
    expect(() => isoDateToJalali("not-a-date")).toThrow();
  });
});
