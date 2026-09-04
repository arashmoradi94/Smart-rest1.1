import { jalaliToGregorian, gregorianToJalali, jalaliMonthLength, formatJalaliDate, formatJalaliMonth } from "../src/lib/jalali";

console.log("1405/6/15 ->", jalaliToGregorian(1405, 6, 15));
console.log("2026-09-06 ->", gregorianToJalali(2026, 9, 6));
console.log("1405/1/1 ->", jalaliToGregorian(1405, 1, 1));
console.log("1403 esfand len:", jalaliMonthLength(1403, 12), "1404:", jalaliMonthLength(1404, 12));
console.log("1403/12/30 ->", jalaliToGregorian(1403, 12, 30));
console.log("fmt:", formatJalaliDate("2026-09-06"), "|", formatJalaliMonth("2026-09"));
let bad = 0;
for (let jy = 1350; jy <= 1450; jy++) {
  for (let jm = 1; jm <= 12; jm++) {
    const L = jalaliMonthLength(jy, jm);
    for (let jd = 1; jd <= L; jd++) {
      const g = jalaliToGregorian(jy, jm, jd);
      const back = gregorianToJalali(g.gy, g.gm, g.gd);
      if (back.jy !== jy || back.jm !== jm || back.jd !== jd) {
        bad++;
        if (bad < 4) console.log("MISMATCH", jy, jm, jd, JSON.stringify(g), JSON.stringify(back));
      }
    }
  }
}
console.log("roundtrip mismatches:", bad);
