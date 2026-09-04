/**
 * Framework-free lifecycle for in-app notification toasts.
 *
 * Every toast owns an INDEPENDENT auto-dismiss timer that starts when the
 * toast is actually displayed (track), never resets on re-render (re-tracking
 * an already-tracked id is a no-op) and is fully cleaned up on manual dismiss
 * or controller teardown. The exit animation is part of the lifecycle: removal
 * happens only after the exit duration elapses, so a toast never vanishes
 * abruptly and no timeout outlives the controller.
 */

/** How long a toast stays fully visible before auto-dismissing. */
export const TOAST_VISIBLE_MS = 5000;
/** Duration of the exit animation before the toast is removed. */
export const TOAST_EXIT_MS = 180;

export interface ToastControllerCallbacks {
  /** The toast should start its exit animation now. */
  onExitStart: (id: string) => void;
  /** The toast has finished its exit animation and must be removed. */
  onRemoved: (id: string) => void;
}

interface VisibleTimer {
  timeout: ReturnType<typeof setTimeout>;
  startedAt: number;
  remaining: number;
}

const now = () => Date.now();

export class ToastController {
  private visible = new Map<string, VisibleTimer>();
  private exiting = new Map<string, ReturnType<typeof setTimeout>>();
  private destroyed = false;

  constructor(
    private readonly cb: ToastControllerCallbacks,
    private readonly visibleMs: number = TOAST_VISIBLE_MS,
    private readonly exitMs: number = TOAST_EXIT_MS,
  ) {}

  /**
   * Start (or keep) the 5s deadline of a displayed toast. Calling this again
   * for the same id — e.g. on every re-render — never resets the deadline.
   */
  track(id: string): void {
    if (this.destroyed || this.visible.has(id) || this.exiting.has(id)) return;
    const timer: VisibleTimer = {
      timeout: setTimeout(() => {
        this.visible.delete(id);
        this.beginExit(id);
      }, this.visibleMs),
      startedAt: now(),
      remaining: this.visibleMs,
    };
    this.visible.set(id, timer);
  }

  /** Stop tracking a toast that left the list without the exit flow. */
  forget(id: string): void {
    const timer = this.visible.get(id);
    if (timer) {
      clearTimeout(timer.timeout);
      this.visible.delete(id);
    }
  }

  /**
   * User-driven dismissal (× button or swipe): cancel the auto-dismiss timer
   * and run the exit animation. Idempotent — a toast already exiting stays so.
   */
  dismiss(id: string): boolean {
    if (this.destroyed || this.exiting.has(id)) return false;
    this.forget(id);
    return this.beginExit(id);
  }

  /** Pause the auto-dismiss deadline (e.g. while the pointer hovers the toast). */
  pause(id: string): void {
    const timer = this.visible.get(id);
    if (!timer) return;
    clearTimeout(timer.timeout);
    timer.remaining = Math.max(0, timer.remaining - (now() - timer.startedAt));
  }

  /** Resume the auto-dismiss deadline with exactly the remaining time. */
  resume(id: string): void {
    if (this.destroyed) return;
    const timer = this.visible.get(id);
    if (!timer) return;
    if (timer.remaining <= 0) {
      this.visible.delete(id);
      this.beginExit(id);
      return;
    }
    timer.startedAt = now();
    timer.timeout = setTimeout(() => {
      this.visible.delete(id);
      this.beginExit(id);
    }, timer.remaining);
  }

  isExiting(id: string): boolean {
    return this.exiting.has(id);
  }

  /** Clear every timeout (auto-dismiss and exit) — nothing survives teardown. */
  destroy(): void {
    for (const timer of this.visible.values()) clearTimeout(timer.timeout);
    for (const timeout of this.exiting.values()) clearTimeout(timeout);
    this.visible.clear();
    this.exiting.clear();
    this.destroyed = true;
  }

  private beginExit(id: string): boolean {
    if (this.destroyed || this.exiting.has(id)) return false;
    const timeout = setTimeout(() => {
      this.exiting.delete(id);
      this.cb.onRemoved(id);
    }, this.exitMs);
    this.exiting.set(id, timeout);
    this.cb.onExitStart(id);
    return true;
  }
}
