"use client";
import { useEffect, useState } from "react";

export const NOTIFICATION_DURATION = 5000;
export const NOTIFICATION_VOLUME = 0.30;

export type NotificationKind = "break-start" | "break-end" | "reminder" | "achievement" | "announcement";
interface InAppNotification {
  title: string;
  body: string;
  kind: NotificationKind;
}

let audioContext: AudioContext | null = null;
const inAppListeners = new Set<(notification: InAppNotification) => void>();

const VIBRATION_PATTERNS: Record<NotificationKind, number | number[]> = {
  "break-start": [70, 80, 70],
  "break-end": [100, 60, 100, 60, 150],
  reminder: 70,
  achievement: [50, 50, 50, 50, 90],
  announcement: 60,
};

function getNotificationKind(tag?: string, kind?: NotificationKind): NotificationKind {
  if (kind) return kind;
  if (tag?.includes(":early") || tag?.includes(":warn")) return "reminder";
  if (tag?.includes(":start")) return "break-start";
  if (tag?.includes(":end")) return "break-end";
  if (tag === "achievement") return "achievement";
  return "announcement";
}

function playNotificationSound(kind: NotificationKind) {
  if (typeof window === "undefined" || !window.AudioContext) return;
  try {
    audioContext ??= new AudioContext();
    const context = audioContext;
    const now = context.currentTime;
    const patterns: Record<NotificationKind, number[]> = {
      "break-start": [392, 587, 784],
      "break-end": [784, 587, 392],
      reminder: [587, 740],
      achievement: [523, 659, 784, 1047],
      announcement: [440, 659],
    };
    const notes = patterns[kind];
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(NOTIFICATION_VOLUME, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, now);
    compressor.knee.setValueAtTime(12, now);
    compressor.ratio.setValueAtTime(4, now);
    gain.connect(compressor).connect(context.destination);

    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.07);
      oscillator.connect(gain);
      oscillator.start(now + index * 0.07);
      oscillator.stop(now + 0.48);
    });
    void context.resume().catch(() => {});
  } catch {}
}

function vibrateNotification(kind: NotificationKind) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(VIBRATION_PATTERNS[kind]);
  }
}

function publishInAppNotification(notification: InAppNotification) {
  inAppListeners.forEach((listener) => listener(notification));
}

function closeAfterDuration(registration: ServiceWorkerRegistration, tag?: string) {
  window.setTimeout(() => {
    void registration.getNotifications(tag ? { tag } : {}).then((notifications) => {
      notifications.forEach((notification) => notification.close());
    }).catch(() => {});
  }, NOTIFICATION_DURATION);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }

  return bytes;
}
async function subscribe(reg: ServiceWorkerRegistration) {
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  const keyRes = await fetch("/api/push/vapid");
  const { publicKey } = await keyRes.json();
  if (!publicKey) return null;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}
export async function enablePush() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    const sub = await subscribe(reg);
    if (sub) {
      await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
    }
  } catch {}
}
export function PushSetup() {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );
  const [toast, setToast] = useState<InAppNotification | null>(null);

  useEffect(() => {
    const listener = (notification: InAppNotification) => setToast(notification);
    inAppListeners.add(listener);
    return () => {
      inAppListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), NOTIFICATION_DURATION);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function enableNotifications() {
    const granted = await requestNotificationPermission();
    setPermission(typeof Notification !== "undefined" ? Notification.permission : "denied");
    if (granted) {
      enablePush();
    }
  }

  return (
    <>
      {toast && (
        <div className="notification-toast" role="status" aria-live="polite">
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </div>
      )}
      {permission !== "granted" && (
        <div className="glass-card flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm" role="status">
          <span>
            {permission === "denied"
              ? "اعلان‌ها مسدود هستند؛ آن‌ها را از تنظیمات مرورگر فعال کنید."
              : "برای دریافت یادآوری استراحت، اعلان‌ها را فعال کنید."}
          </span>
          {permission !== "denied" && (
            <button
              type="button"
              onClick={enableNotifications}
              className="shrink-0 rounded-xl px-3 py-2 font-bold text-white"
              style={{ background: "var(--break)" }}
            >
              فعال‌سازی
            </button>
          )}
        </div>
      )}
    </>
  );
}
export async function notify(title: string, body: string, tag?: string, kind?: NotificationKind) {
  try {
    const notificationKind = getNotificationKind(tag, kind);
    publishInAppNotification({ title, body, kind: notificationKind });
    vibrateNotification(notificationKind);
    playNotificationSound(notificationKind);
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: "/icon.svg",
        dir: "rtl",
        lang: "fa",
        tag,
      });
      closeAfterDuration(reg, tag);
    } else {
      const notification = new Notification(title, {
        body,
        icon: "/icon.svg",
        dir: "rtl",
        lang: "fa",
        tag,
      });
      window.setTimeout(() => notification.close(), NOTIFICATION_DURATION);
    }
  } catch {}
}
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}