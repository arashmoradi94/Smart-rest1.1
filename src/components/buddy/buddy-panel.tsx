"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Coffee, Handshake, Loader2, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import { formatPersianNumber, formatPersianTime } from "@/lib/utils";
import { useTransientMessage } from "@/lib/use-transient";
import type { BuddyMatchView } from "@/types";

interface BuddyData {
  buddies: Array<{ id: string; name: string }>;
  incomingRequests: Array<{ id: string; from: string }>;
  outgoingRequests: Array<{ id: string; to: string }>;
  maxBuddies: number;
}
interface GroupStatus {
  status: string;
  endsAt: string | null;
  members: Array<{ userId: string; name: string; ready: boolean }>;
}
interface Coworker {
  id: string;
  name: string;
}
interface BreakInviteData {
  incoming: Array<{ id: string; from: string; fromId: string; createdAt: string }>;
  outgoing: Array<{ id: string; to: string; toId: string; createdAt: string }>;
}

export function BuddyPanel({
  userStatus,
  suggestions = [],
  timezone,
}: {
  userStatus: string;
  suggestions?: BuddyMatchView[];
  timezone?: string;
}) {
  const [data, setData] = useState<BuddyData | null>(null);
  const [group, setGroup] = useState<GroupStatus | null>(null);
  const [coworkers, setCoworkers] = useState<Coworker[]>([]);
  const [invites, setInvites] = useState<BreakInviteData>({ incoming: [], outgoing: [] });
  const [shiftPeers, setShiftPeers] = useState<Coworker[]>([]);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useTransientMessage();
  const [picking, setPicking] = useState(false);
  const [dismissedMatches, setDismissedMatches] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/buddy/requests", { cache: "no-store" });
      if (r.ok) setData(await r.json());
      const g = await fetch("/api/buddy/group/status", { cache: "no-store" });
      setGroup(g.ok ? await g.json() : null);
      const i = await fetch("/api/break-request", { cache: "no-store" });
      if (i.ok) setInvites(await i.json());
    } catch {}
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
    fetch("/api/coworkers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((users: Coworker[]) => setCoworkers(users))
      .catch(() => {});
    fetch("/api/break-request/coworkers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((users: Coworker[]) => setShiftPeers(users))
      .catch(() => {});
  }, [load]);

  // Poll group status while a group is forming/active
  useEffect(() => {
    if (group && (group.status === "FORMING" || group.status === "DELAYED" || group.status === "ACTIVE")) {
      timer.current = setInterval(load, 5000);
      return () => {
        if (timer.current) clearInterval(timer.current);
      };
    }
  }, [group, load]);

  async function act(fn: () => Promise<unknown>, successMsg?: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await fn();
      if (successMsg) setMsg(successMsg);
      await load();
    } catch {
      setMsg("خطا در انجام عملیات");
    } finally {
      setBusy(false);
    }
  }

  const post = (url: string, body: unknown) => () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error);
      }
    });

  if (!data) return null;

  const atCapacity = data.buddies.length >= data.maxBuddies;
  const visibleMatches = suggestions.filter((s) => !dismissedMatches.has(s.userId));
  const dismissMatch = (userId: string) =>
    setDismissedMatches((prev) => new Set(prev).add(userId));

  return (
    <section className="glass-card flex flex-col gap-3 rounded-3xl p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <Handshake className="size-4" aria-hidden />
        هم‌شیفتی‌ها
      </h2>

      {/* Incoming requests */}
      {data.incomingRequests.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.incomingRequests.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm"
              style={{ background: "rgba(99,102,241,.08)" }}
            >
              <span>
                درخواست از <b>{r.from}</b>
              </span>
              <span className="flex gap-1.5">
                <button
                  onClick={() => act(post("/api/buddy/respond", { requestId: r.id, accept: true }), "✓ تأیید شد")}
                  disabled={busy}
                  className="flex size-8 items-center justify-center rounded-lg text-white disabled:opacity-50"
                  style={{ background: "var(--working)" }}
                  aria-label={`تأیید ${r.from}`}
                >
                  <Check className="size-4" aria-hidden />
                </button>
                <button
                  onClick={() => act(post("/api/buddy/respond", { requestId: r.id, accept: false }))}
                  disabled={busy}
                  className="flex size-8 items-center justify-center rounded-lg text-white disabled:opacity-50"
                  style={{ background: "var(--muted)" }}
                  aria-label={`رد ${r.from}`}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Same-shift break invitations */}
      {(invites.incoming.length > 0 || invites.outgoing.length > 0 || inviting) && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold">☕ دعوت استراحت همزمان</p>
          {invites.incoming.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm"
              style={{ background: "rgba(245,158,11,.1)" }}
            >
              <span className="min-w-0">
                <b>{r.from}</b> از شما خواست همزمان استراحت کنید
              </span>
              <span className="flex shrink-0 gap-1.5">
                <button
                  onClick={() =>
                    act(post("/api/break-request/respond", { requestId: r.id, accept: true }), "دعوت پذیرفته شد ✓")
                  }
                  disabled={busy}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "var(--working)" }}
                  aria-label={`پذیرش دعوت ${r.from}`}
                >
                  می‌آیم
                </button>
                <button
                  onClick={() =>
                    act(post("/api/break-request/respond", { requestId: r.id, accept: false }), "دعوت رد شد")
                  }
                  disabled={busy}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "var(--muted)" }}
                  aria-label={`رد دعوت ${r.from}`}
                >
                  نه
                </button>
              </span>
            </div>
          ))}
          {invites.outgoing.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs"
              style={{ background: "rgba(148,163,184,.08)" }}
            >
              <span>
                در انتظار پاسخ <b>{r.to}</b>…
              </span>
              <button
                onClick={() => act(post("/api/break-request/cancel", { requestId: r.id }), "دعوت لغو شد")}
                disabled={busy}
                className="rounded-lg px-2.5 py-1.5 text-xs font-bold disabled:opacity-50"
                style={{ background: "rgba(239,68,68,.1)", color: "var(--danger)" }}
                aria-label={`لغو دعوت ${r.to}`}
              >
                لغو
              </button>
            </div>
          ))}
          {inviting && (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-xl p-2" style={{ background: "rgba(148,163,184,.08)" }}>
              {shiftPeers.length === 0 && (
                <li className="px-1 py-1.5 text-xs" style={{ color: "var(--muted)" }}>
                  هم‌شیفت آنلاینی برای دعوت وجود ندارد.
                </li>
              )}
              {shiftPeers
                .filter((c) => !invites.outgoing.some((o) => o.toId === c.id))
                .map((c) => (
                  <li key={c.id} className="flex items-center justify-between text-sm">
                    <span>{c.name}</span>
                    <button
                      onClick={() =>
                        act(post("/api/break-request", { recipientId: c.id }), "دعوت ارسال شد ✓").then(() =>
                          setInviting(false),
                        )
                      }
                      disabled={busy}
                      className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                      style={{ background: "var(--break)" }}
                    >
                      دعوت به استراحت
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {/* Confirmed buddies */}
      {data.buddies.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {data.buddies.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-xl px-3 py-2 text-sm"
              style={{ background: "rgba(148,163,184,.08)" }}
            >
              <span className="font-medium">{b.name}</span>
              <button
                onClick={() => act(post("/api/buddy/remove", { buddyId: b.id }), "حذف شد")}
                disabled={busy}
                className="flex size-8 items-center justify-center rounded-lg disabled:opacity-50"
                style={{ background: "rgba(239,68,68,.1)", color: "var(--danger)" }}
                aria-label={`حذف ${b.name}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          هنوز هم‌شیفتی نداری — تا {data.maxBuddies} نفر را انتخاب کن تا استراحت گروهی داشته باشید.
        </p>
      )}

      {/* Outgoing pending */}
      {data.outgoingRequests.length > 0 && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          در انتظار پاسخ: {data.outgoingRequests.map((r) => r.to).join("، ")}
        </p>
      )}

      {/* Add buddy */}
      {!atCapacity && !picking && (
        <button
          onClick={() => setPicking(true)}
          className="rounded-xl py-2.5 text-sm font-bold"
          style={{ background: "rgba(99,102,241,.1)", color: "var(--break)" }}
        >
          + انتخاب هم‌شیفتی
        </button>
      )}
      {picking && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-xl p-2" style={{ background: "rgba(148,163,184,.08)" }}>
          {coworkers
            .filter((c) => !data.buddies.some((b) => b.id === c.id))
            .map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <span>{c.name}</span>
                <button
                  onClick={() =>
                    act(post("/api/buddy/requests", { addresseeId: c.id }), "درخواست ارسال شد ✓").then(() =>
                      setPicking(false),
                    )
                  }
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: "var(--break)" }}
                >
                  ارسال درخواست
                </button>
              </li>
            ))}
        </ul>
      )}

      {/* Break Matching — quiet, dismissible suggestions; never blocks your own break */}
      {userStatus === "WORKING" && visibleMatches.length > 0 && !group && (
        <div className="flex flex-col gap-1.5 rounded-2xl p-3" style={{ background: "rgba(99,102,241,.06)" }}>
          <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: "var(--break)" }}>
            <Sparkles className="size-3.5" aria-hidden />
            هماهنگی استراحت (پیشنهاد)
          </p>
          <ul className="flex flex-col gap-1">
            {visibleMatches.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs" style={{ background: "rgba(148,163,184,.08)" }}>
                <span className="min-w-0">
                  <b>{m.name}</b>{" "}
                  {formatPersianNumber(m.minutesUntilBreak)} دقیقه دیگر استراحت دارد
                  {timezone && (
                    <span style={{ color: "var(--muted)" }}> ({formatPersianTime(m.scheduledStart, timezone)})</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {!m.isBuddy && !atCapacity && (
                    <button
                      onClick={() => act(post("/api/buddy/requests", { addresseeId: m.userId }), "درخواست هم‌شیفتی ارسال شد ✓")}
                      disabled={busy}
                      className="flex size-7 items-center justify-center rounded-lg text-white disabled:opacity-50"
                      style={{ background: "var(--break)" }}
                      aria-label={`ارسال درخواست هم‌شیفتی به ${m.name}`}
                      title="ارسال درخواست هم‌شیفتی"
                    >
                      <UserPlus className="size-3.5" aria-hidden />
                    </button>
                  )}
                  <button
                    onClick={() => dismissMatch(m.userId)}
                    className="flex size-7 items-center justify-center rounded-lg"
                    style={{ background: "rgba(100,116,139,.1)", color: "var(--muted)" }}
                    aria-label={`رد پیشنهاد ${m.name}`}
                    title="رد پیشنهاد"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>
            پیشنهاد است — استراحت عادی شما هیچ تغییری نمی‌کند.
          </p>
        </div>
      )}

      {/* Group break */}
      {(group?.status === "FORMING" || group?.status === "DELAYED") && (
        <div className="flex flex-col gap-2 rounded-2xl p-3" style={{ background: "rgba(245,158,11,.1)" }}>
          <p className="text-center text-sm font-bold" style={{ color: "var(--warning)" }}>
            {group.status === "DELAYED" ? "⏳ ظرفیت مناسب نیست؛ در صف استراحت گروهی هستید…" : "⏳ منتظر آماده‌شدن هم‌تیمی هستیم…"}
          </p>
          <ul className="flex flex-col gap-1">
            {group.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between text-xs">
                <span>{m.name}</span>
                <span style={{ color: m.ready ? "var(--working)" : "var(--muted)" }}>
                  {m.ready ? "✓ آماده" : "در تماس…"}
                </span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => act(post("/api/buddy/group/ready", {}))}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-60"
            style={{ background: "var(--break)" }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Coffee className="size-4" aria-hidden />}
            من هم آماده‌ام
          </button>
        </div>
      )}
      {group?.status === "ACTIVE" && group.endsAt && (
        <div
          className="rounded-2xl p-3 text-center text-sm font-bold"
          style={{ background: "rgba(99,102,241,.1)", color: "var(--break)" }}
        >
          ☕ استراحت گروهی شروع شد — از تایمر اصلی استفاده کن
        </div>
      )}

      {userStatus === "WORKING" && !group && (
        <button
          onClick={() => setInviting((v) => !v)}
          disabled={busy}
          className="rounded-xl py-2.5 text-sm font-bold disabled:opacity-60"
          style={{ background: "rgba(245,158,11,.1)", color: "var(--warning)" }}
        >
          ☕ دعوت هم‌شیفتی به استراحت همزمان
        </button>
      )}

      {userStatus === "WORKING" && data.buddies.length > 0 && !group && (
        <button
          onClick={() => act(post("/api/buddy/group/ready", {}))}
          disabled={busy}
          className="rounded-xl py-2.5 text-sm font-bold"
          style={{ background: "rgba(99,102,241,.1)", color: "var(--break)" }}
        >
          ☕ استراحت گروهی با هم‌شیفتی
        </button>
      )}

      {msg && (
        <p className="text-center text-xs font-medium" role="status" style={{ color: "var(--working)" }}>
          {msg}
        </p>
      )}
    </section>
  );
}
