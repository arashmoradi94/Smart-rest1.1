"use client";

import {
  formatJalaliDate,
  gregorianToJalali,
  isoDateToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  jalaliToIsoDate,
  monthKeyToJalali,
  JALALI_MONTH_NAMES,
} from "@/lib/jalali";

const JALALI_MONTHS = JALALI_MONTH_NAMES;

function toPersianDigitsUi(value: string): string {
  return value.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Small RTL select styled by globals.css (.jalali-*). */
function JalaliSelect({ label, value, onChange, options }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  options: Array<{ value: number; label: string }>;
}) {
  return (
    <label className="jalali-field">
      <span className="jalali-field-label">{label}</span>
      <select
        dir="rtl"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="jalali-select"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/** "YYYY-MM-DD" → Jalali parts; an unreadable value falls back to today. */
function parseIsoDate(value: string) {
  try {
    return isoDateToJalali(value);
  } catch {
    const today = new Date();
    return gregorianToJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
  }
}

/**
 * RTL Persian (Jalali) DATE picker — day, month and year, all in Persian.
 * `value`/`onChange` use the backend-standard Gregorian "YYYY-MM-DD" string,
 * while the UI never shows a raw Gregorian date. The day list always follows
 * the selected month's length (leap-year Esfand included); switching to a
 * shorter month clamps the day instead of shifting it. Conversion works on
 * calendar numbers only, so no machine timezone can move the date by a day.
 */
export function JalaliDatePicker({ value, onChange, label }: {
  value: string;
  onChange: (isoDate: string) => void;
  label?: string;
}) {
  const today = new Date();
  const fallback = gregorianToJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const parsed = parseIsoDate(value);
  const jy = parsed.jy;
  const jm = parsed.jm;
  const monthLength = jalaliMonthLength(jy, jm);
  const jd = Math.min(parsed.jd, monthLength);
  const years = Array.from({ length: 7 }, (_, i) => fallback.jy - 2 + i);

  const emit = (y: number, m: number, d: number) => onChange(jalaliToIsoDate(y, m, d));

  return (
    <div className="jalali-date-picker" dir="rtl">
      {label && <span className="jalali-picker-title">{label}</span>}
      <div className="jalali-date-fields">
        <JalaliSelect
          label="روز"
          value={jd}
          onChange={(d) => emit(jy, jm, d)}
          options={Array.from({ length: monthLength }, (_, i) => ({
            value: i + 1,
            label: toPersianDigitsUi(String(i + 1)),
          }))}
        />
        <JalaliSelect
          label="ماه"
          value={jm}
          onChange={(m) => emit(jy, m, Math.min(jd, jalaliMonthLength(jy, m)))}
          options={JALALI_MONTHS.map((name, i) => ({ value: i + 1, label: name }))}
        />
        <JalaliSelect
          label="سال"
          value={jy}
          onChange={(y) => emit(y, jm, jd)}
          options={years.map((y) => ({ value: y, label: toPersianDigitsUi(String(y)) }))}
        />
      </div>
      <p className="jalali-selected-date">تاریخ انتخابی: {formatJalaliDate(jalaliToIsoDate(jy, jm, jd))}</p>
    </div>
  );
}

/**
 * RTL Persian (Jalali) month picker.
 * `value`/`onChange` use the backend-standard Gregorian "YYYY-MM" key, while
 * the UI is fully Persian: Jalali months/years, Persian digits, RTL layout.
 */
export function JalaliMonthPicker({ value, onChange }: {
  value: string;
  onChange: (monthKey: string) => void;
}) {
  const today = new Date();
  const fallback = gregorianToJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const { jy, jm } = (() => {
    try {
      return monthKeyToJalali(value);
    } catch {
      return fallback;
    }
  })();

  const years = Array.from({ length: 7 }, (_, i) => fallback.jy - 2 + i);

  function shift(deltaMonths: number) {
    let y = jy;
    let m = jm + deltaMonths;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    const g = jalaliToGregorian(y, m, 1);
    onChange(`${g.gy}-${pad(g.gm)}`);
  }

  return (
    <div className="jalali-month-picker" dir="rtl">
      <div className="jalali-month-nav">
        <button type="button" aria-label="ماه بعد" onClick={() => shift(1)}>‹</button>
        <span className="jalali-month-title">
          {JALALI_MONTHS[jm - 1]} {toPersianDigitsUi(String(jy))}
        </span>
        <button type="button" aria-label="ماه قبل" onClick={() => shift(-1)}>›</button>
      </div>
      <div className="jalali-month-fields">
        <JalaliSelect
          label="ماه"
          value={jm}
          onChange={(m) => {
            const g = jalaliToGregorian(jy, m, 1);
            onChange(`${g.gy}-${pad(g.gm)}`);
          }}
          options={JALALI_MONTHS.map((name, i) => ({ value: i + 1, label: name }))}
        />
        <JalaliSelect
          label="سال"
          value={jy}
          onChange={(y) => {
            const g = jalaliToGregorian(y, jm, 1);
            onChange(`${g.gy}-${pad(g.gm)}`);
          }}
          options={years.map((y) => ({ value: y, label: toPersianDigitsUi(String(y)) }))}
        />
      </div>
    </div>
  );
}
