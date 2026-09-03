"use client";

import { useEffect, useState } from "react";
import { formatPersianNumber } from "@/lib/utils";

type Assignment = { id: string; date: string; startTime: string; endTime: string; allocation: string; user: { name: string; username: string } };
type Schedule = { monthKey: string; mode: string; startTime: string; endTime: string; published: boolean; assignments: Assignment[] } | null;

export function DinnerTab() {
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [schedule, setSchedule] = useState<Schedule>(null);
  const [mode, setMode] = useState<"AUTO" | "MANUAL">("AUTO");
  const [startTime, setStartTime] = useState("19:40");
  const [endTime, setEndTime] = useState("21:00");
  const [message, setMessage] = useState("");
  const load = async () => {
    const r = await fetch(`/api/admin/dinner?month=${monthKey}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    setSchedule(d);
    if (d) {
      setMode(d.mode);
      setStartTime(d.startTime);
      setEndTime(d.endTime);
    }
  };
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/admin/dinner?month=${monthKey}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (cancelled) return;
        setSchedule(d);
        if (d) {
          setMode(d.mode);
          setStartTime(d.startTime);
          setEndTime(d.endTime);
        }
      });
    return () => { cancelled = true; };
  }, [monthKey]);

  async function save() {
    const r = await fetch("/api/admin/dinner", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthKey, mode, startTime, endTime }),
    });
    setMessage(r.ok ? "برنامه شام ذخیره شد." : (await r.json()).error ?? "ذخیره ناموفق بود.");
    if (r.ok) await load();
  }

  async function publish(published: boolean) {
    const r = await fetch("/api/admin/dinner", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthKey, published }),
    });
    if (r.ok) await load();
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="glass-card rounded-3xl p-4">
        <h2 className="mb-3 text-sm font-bold">🍽️ برنامه شام</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">ماه<input type="month" value={monthKey} onChange={(e) => setMonthKey(e.target.value)} className="mt-1 w-full rounded-xl bg-transparent p-2" /></label>
          <label className="text-xs">حالت
            <select value={mode} onChange={(e) => setMode(e.target.value as "AUTO" | "MANUAL")} className="mt-1 w-full rounded-xl bg-transparent p-2">
              <option value="AUTO">خودکار</option><option value="MANUAL">دستی</option>
            </select>
          </label>
          <label className="text-xs">شروع<input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 w-full rounded-xl bg-transparent p-2" /></label>
          <label className="text-xs">پایان<input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 w-full rounded-xl bg-transparent p-2" /></label>
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>مدت هر نوبت: ۲۰ دقیقه</p>
        <div className="mt-3 flex gap-2">
          <button onClick={save} className="rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: "var(--break)" }}>تولید و ذخیره</button>
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
              <tbody>{schedule.assignments.slice(0, 100).map((a) => <tr key={a.id}><td className="p-2">{a.user.name}</td><td className="p-2">{a.date}</td><td className="p-2" dir="ltr">{a.startTime} تا {a.endTime}</td><td className="p-2">{a.allocation === "MANUAL" ? "دستی" : "خودکار"}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
