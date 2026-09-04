"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { formatPersianNumber } from "@/lib/utils";
import { formatJalaliDate } from "@/lib/jalali";
import { JalaliDatePicker, JalaliMonthPicker } from "@/lib/jalali-picker";

type Assignment = { id: string; date: string; startTime: string; endTime: string; allocation: string; user: { id: string; name: string; username: string } };
type Schedule = { monthKey: string; mode: string; startTime: string; endTime: string; published: boolean; assignments: Assignment[] } | null;
type DraftAssignment = { userId: string; date: string; startTime: string; endTime: string };
type AdminUser = { id: string; name: string; role: string };

/** 20-minute slots between two "HH:MM" times (mirrors the server rule). */
function slotsBetween(startTime: string, endTime: string): Array<{ startTime: string; endTime: string }> {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const toTime = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  const out: Array<{ startTime: string; endTime: string }> = [];
  for (let m = toMinutes(startTime); m + 20 <= toMinutes(endTime); m += 20) {
    out.push({ startTime: toTime(m), endTime: toTime(m + 20) });
  }
  return out;
}

export function DinnerTab() {
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [schedule, setSchedule] = useState<Schedule>(null);
  const [mode, setMode] = useState<"AUTO" | "MANUAL">("AUTO");
  const [startTime, setStartTime] = useState("19:40");
  const [endTime, setEndTime] = useState("21:00");
  const [message, setMessage] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [draft, setDraft] = useState<DraftAssignment[]>([]);
  const [newUserId, setNewUserId] = useState("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newSlot, setNewSlot] = useState("19:40");
  const [saving, setSaving] = useState(false);

  const slotList = useMemo(() => slotsBetween(startTime, endTime), [startTime, endTime]);

  const applySchedule = (d: Schedule) => {
    setSchedule(d);
    if (d) {
      setMode(d.mode as "AUTO" | "MANUAL");
      setStartTime(d.startTime);
      setEndTime(d.endTime);
      setDraft(d.assignments.map((a) => ({ userId: a.user.id, date: a.date, startTime: a.startTime, endTime: a.endTime })));
    } else {
      setDraft([]);
    }
  };

  const load = async () => {
    const r = await fetch(`/api/admin/dinner?month=${monthKey}`, { cache: "no-store" });
    if (!r.ok) return;
    applySchedule(await r.json());
  };
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/admin/dinner?month=${monthKey}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok || cancelled) return;
        applySchedule(await r.json());
      });
    return () => { cancelled = true; };
  }, [monthKey]);

  useEffect(() => {
    fetch("/api/admin/users", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: AdminUser[]) => setUsers(list.filter((u) => u.role !== "ADMIN")))
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      const body =
        mode === "AUTO"
          ? { monthKey, mode, startTime, endTime }
          : { monthKey, mode, startTime, endTime, assignments: draft };
      const r = await fetch("/api/admin/dinner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setMessage(r.ok ? "برنامه شام ذخیره شد." : ((await r.json()).error ?? "ذخیره ناموفق بود."));
      if (r.ok) await load();
    } finally {
      setSaving(false);
    }
  }

  function addAssignment() {
    const slot = slotList.find((s) => s.startTime === newSlot);
    if (!newUserId || !slot) {
      setMessage("کارمند و نوبت را انتخاب کنید.");
      return;
    }
    if (draft.some((a) => a.userId === newUserId && a.date === newDate)) {
      setMessage("برای این کارمند در این تاریخ قبلاً نوبت ثبت شده است.");
      return;
    }
    setDraft((current) => [...current, { userId: newUserId, date: newDate, startTime: slot.startTime, endTime: slot.endTime }]);
    setMessage("");
  }

  async function publish(published: boolean) {
    const r = await fetch("/api/admin/dinner", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthKey, published }),
    });
    if (r.ok) await load();
  }

  const nameOf = (userId: string) => users.find((u) => u.id === userId)?.name ?? userId;

  return (
    <section className="flex flex-col gap-3">
      <div className="glass-card rounded-3xl p-4">
        <h2 className="mb-3 text-sm font-bold">🍽️ برنامه شام</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs">ماه
            <JalaliMonthPicker value={monthKey} onChange={setMonthKey} />
          </label>
          <div className="flex flex-col gap-2 text-xs">
            <label>حالت
              <select value={mode} onChange={(e) => setMode(e.target.value as "AUTO" | "MANUAL")} className="mt-1 w-full rounded-xl bg-transparent p-2">
                <option value="AUTO">خودکار</option><option value="MANUAL">دستی</option>
              </select>
            </label>
            <label>شروع<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 w-full rounded-xl bg-transparent p-2" /></label>
            <label>پایان<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 w-full rounded-xl bg-transparent p-2" /></label>
          </div>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>مدت هر نوبت: ۲۰ دقیقه</p>

        {mode === "MANUAL" && (
          <div className="mt-3 flex flex-col gap-2 rounded-2xl p-3" style={{ background: "rgba(148,163,184,.08)" }}>
            <p className="text-xs font-bold">نوبت دستی برای روز مشخص</p>
            <label className="text-xs">کارمند
              <select value={newUserId} onChange={(e) => setNewUserId(e.target.value)} className="mt-1 w-full rounded-xl bg-transparent p-2">
                <option value="">— انتخاب کنید —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <JalaliDatePicker label="تاریخ (شمسی)" value={newDate} onChange={setNewDate} />
            <label className="text-xs">نوبت
              <select value={newSlot} onChange={(e) => setNewSlot(e.target.value)} className="mt-1 w-full rounded-xl bg-transparent p-2">
                {slotList.map((s) => (
                  <option key={s.startTime} value={s.startTime} dir="ltr">{s.startTime} تا {s.endTime}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={addAssignment}
              className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold"
              style={{ background: "rgba(99,102,241,.12)", color: "var(--break)" }}
            >
              <Plus className="size-4" aria-hidden /> افزودن به برنامه
            </button>
            {draft.length > 0 && (
              <ul className="flex flex-col gap-1">
                {draft.map((a, i) => (
                  <li
                    key={`${a.userId}-${a.date}-${a.startTime}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-xs"
                    style={{ background: "rgba(148,163,184,.1)" }}
                  >
                    <span className="min-w-0 truncate">{nameOf(a.userId)}</span>
                    <span className="shrink-0">{formatJalaliDate(a.date)}</span>
                    <span className="shrink-0" dir="ltr">{a.startTime}–{a.endTime}</span>
                    <button
                      type="button"
                      onClick={() => setDraft((current) => current.filter((_, index) => index !== i))}
                      className="shrink-0 rounded-lg p-1"
                      style={{ color: "var(--danger)" }}
                      aria-label={`حذف نوبت ${nameOf(a.userId)} در ${formatJalaliDate(a.date)}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px]" style={{ color: "var(--muted)" }}>
              ذخیره در حالت دستی، برنامه ماه را با همین فهرست جایگزین می‌کند.
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-60" style={{ background: "var(--break)" }}>
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            تولید و ذخیره
          </button>
          {schedule && <button onClick={() => publish(!schedule.published)} className="rounded-xl px-4 py-2 text-xs font-bold" style={{ background: "rgba(148,163,184,.12)" }}>{schedule.published ? "لغو انتشار" : "انتشار برای کارکنان"}</button>}
        </div>
        {message && <p className="mt-2 text-xs" style={{ color: "var(--working)" }}>{message}</p>}
      </div>
      {schedule && (
        <div className="glass-card rounded-3xl p-4">
          <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>
            {formatPersianNumber(schedule.assignments.length)} تخصیص · {schedule.published ? "منتشرشده" : "پیش‌نویس"}
          </p>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-right text-xs">
              <thead><tr><th className="p-2">کارمند</th><th className="p-2">تاریخ</th><th className="p-2">زمان</th><th className="p-2">نوع</th></tr></thead>
              <tbody>{schedule.assignments.slice(0, 100).map((a) => <tr key={a.id}><td className="p-2">{a.user.name}</td><td className="p-2">{formatJalaliDate(a.date)}</td><td className="p-2" dir="ltr">{a.startTime} تا {a.endTime}</td><td className="p-2">{a.allocation === "MANUAL" ? "دستی" : "خودکار"}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
