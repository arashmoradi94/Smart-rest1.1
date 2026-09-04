import { useCallback, useEffect, useState } from "react";

/**
 * Consistent lifecycle for transient UI feedback alerts (error / success /
 * warning / rate-limit banners and inline status messages).
 *
 * WHY a separate primitive instead of reusing ToastController: the in-app
 * notification toasts (ToastController + push-setup) are multi-slot,
 * server-driven events with title/body/kind, sound, vibration and a
 * notification centre. The feedback alerts below are single-slot,
 * user-action-driven messages rendered in their own inline / bottom banners.
 * Both systems share the SAME acceptance criteria; this module gives the
 * transient alerts one implementation shared by every alert site, so no site
 * rolls its own setTimeout and no timer ever leaks.
 *
 * Guarantees (identical to the notification toasts):
 *  - auto-dismiss at most 5s after the message is SHOWN
 *  - `show()` is the only entry point that (re)starts a deadline, so a plain
 *    re-render never resets a running timer
 *  - showing a new message replaces the visible one and cancels its timer; a
 *    cancelled timer can never fire later (a dismissed alert never reappears)
 *  - `dismiss()` clears the message immediately (manual ×) and cancels the timer
 *  - `destroy()` (component unmount) clears every pending timer
 *  - the bus only owns UI state — dismissing never touches business data
 *
 * For MULTI-slot concurrent alerts (several toasts at once, each with its own
 * independent timer) the notification system already exists: ToastController.
 */
export const TRANSIENT_MESSAGE_MS = 5000;

interface MessageTimer {
  timeout: ReturnType<typeof setTimeout>;
}

/** Framework-free single-slot message lifecycle (unit-testable in node). */
export class TransientMessageBus<T = string> {
  private timer: MessageTimer | null = null;
  private destroyed = false;

  constructor(
    private readonly onMessage: (message: T | "") => void,
    private readonly messageMs: number = TRANSIENT_MESSAGE_MS,
  ) {}

  /**
   * Show a message: replaces the visible message (if any) and starts a fresh
   * auto-dismiss deadline. Passing an empty value only clears the slot.
   */
  show(message: T | ""): void {
    if (this.destroyed) return;
    this.clearTimer();
    if (message === "" || message === null || message === undefined) {
      this.onMessage("" as T);
      return;
    }
    this.onMessage(message);
    this.timer = {
      timeout: setTimeout(() => {
        this.timer = null;
        this.onMessage("" as T);
      }, this.messageMs),
    };
  }

  /** Immediate manual dismissal (× button): cancel deadline and clear the slot. */
  dismiss(): void {
    if (this.destroyed) return;
    this.clearTimer();
    this.onMessage("" as T);
  }

  /** Teardown on unmount — no timer ever outlives its component. */
  destroy(): void {
    this.clearTimer();
    this.destroyed = true;
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer.timeout);
    this.timer = null;
  }
}

/**
 * React binding around `TransientMessageBus`. Returns `[message, show, dismiss]`.
 *  - `show(msg)` displays a message and (re)starts the auto-dismiss deadline;
 *    `show("")` only clears the slot (no timer is started).
 *  - `dismiss()` clears immediately — wired to a manual × button where present.
 *
 * The bus instance is created once for the component's lifetime (lazy useState
 * initializer, same pattern as ToastController in push-setup); `show` is only
 * called from event/effect handlers, so re-renders never reset a running timer.
 */
export function useTransientMessage<T = string>(
  durationMs: number = TRANSIENT_MESSAGE_MS,
): readonly [T | "", (message: T | "") => void, () => void] {
  const [message, setMessage] = useState<T | "">("");
  const [bus] = useState(() => new TransientMessageBus<T>(setMessage, durationMs));

  useEffect(() => () => bus.destroy(), [bus]);

  const show = useCallback((next: T | "") => bus.show(next), [bus]);
  const dismiss = useCallback(() => bus.dismiss(), [bus]);

  return [message, show, dismiss] as const;
}