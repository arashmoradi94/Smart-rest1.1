import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_EXIT_MS, TOAST_VISIBLE_MS, ToastController } from "@/lib/toast-controller";

/**
 * In-app notification lifecycle (acceptance item 1):
 *  - independent 5s auto-dismiss per toast, measured from display
 *  - manual dismissal (×/swipe) clears the toast's own timer
 *  - re-render / re-tracking never resets a running deadline
 *  - dismissing one toast never touches the others
 *  - teardown leaves no dangling setTimeout behind
 */
describe("ToastController (in-app notification lifecycle)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeController() {
    const events: Array<{ id: string; event: "exit" | "removed"; at: number }> = [];
    const t0 = Date.now();
    const controller = new ToastController({
      onExitStart: (id) => events.push({ id, event: "exit", at: Date.now() - t0 }),
      onRemoved: (id) => events.push({ id, event: "removed", at: Date.now() - t0 }),
    });
    return { controller, events };
  }

  it("auto-dismisses one toast: exit at 5s, removal after the exit animation", () => {
    const { controller, events } = makeController();
    controller.track("a");
    vi.advanceTimersByTime(TOAST_VISIBLE_MS - 1);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual([{ id: "a", event: "exit", at: TOAST_VISIBLE_MS }]);
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(events).toEqual([
      { id: "a", event: "exit", at: TOAST_VISIBLE_MS },
      { id: "a", event: "removed", at: TOAST_VISIBLE_MS + TOAST_EXIT_MS },
    ]);
    controller.destroy();
  });

  it("two toasts shown together get independent timers and dismiss independently", () => {
    const { controller, events } = makeController();
    controller.track("a");
    controller.track("b");
    vi.advanceTimersByTime(TOAST_VISIBLE_MS);
    // both exit at the same instant — each with its own timer
    expect(events.filter((e) => e.event === "exit").length).toBe(2);
    // dismissing "a" after its exit started is a no-op; "b" still removes itself
    controller.dismiss("a");
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(events.filter((e) => e.event === "removed").map((e) => e.id).sort()).toEqual(["a", "b"]);
    controller.destroy();
  });

  it("manual dismiss removes only that toast, immediately starting its exit", () => {
    const { controller, events } = makeController();
    controller.track("a");
    controller.track("b");
    vi.advanceTimersByTime(1000);
    expect(controller.dismiss("a")).toBe(true);
    expect(events).toEqual([{ id: "a", event: "exit", at: 1000 }]);
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(events).toEqual([
      { id: "a", event: "exit", at: 1000 },
      { id: "a", event: "removed", at: 1000 + TOAST_EXIT_MS },
    ]);
    // b's original deadline is untouched: fires at 5s, not shifted by a's dismissal
    vi.advanceTimersByTime(TOAST_VISIBLE_MS - 1000 - TOAST_EXIT_MS - 1);
    expect(events.filter((e) => e.id === "b")).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events.filter((e) => e.id === "b").map((e) => e.event)).toEqual(["exit"]);
    controller.destroy();
  });

  it("dismiss clears the auto timer: no late auto-dismiss after manual removal", () => {
    const { controller, events } = makeController();
    controller.track("a");
    vi.advanceTimersByTime(2000);
    controller.dismiss("a");
    vi.advanceTimersByTime(TOAST_EXIT_MS);
    expect(events.filter((e) => e.id === "a" && e.event === "removed").length).toBe(1);
    vi.advanceTimersByTime(TOAST_VISIBLE_MS); // well past the original deadline
    expect(events.filter((e) => e.id === "a").length).toBe(2); // exit + removed only
    controller.destroy();
  });

  it("re-render / re-tracking does not reset a running deadline", () => {
    const { controller, events } = makeController();
    controller.track("a");
    vi.advanceTimersByTime(3000);
    controller.track("a"); // simulates the sync effect re-running on re-render
    controller.track("a");
    vi.advanceTimersByTime(2000);
    // fires exactly at 5s from the FIRST display, not 5s after re-track
    expect(events).toEqual([{ id: "a", event: "exit", at: TOAST_VISIBLE_MS }]);
    controller.destroy();
  });

  it("a genuinely new notification id gets its own fresh deadline", () => {
    const { controller, events } = makeController();
    controller.track("n1");
    vi.advanceTimersByTime(3000);
    controller.track("n2");
    vi.advanceTimersByTime(2000);
    expect(events.map((e) => e.id)).toEqual(["n1"]);
    vi.advanceTimersByTime(3000);
    expect(events.filter((e) => e.id === "n2").map((e) => e.event)).toEqual(["exit"]);
    controller.destroy();
  });

  it("pause/resume postpones the deadline by exactly the paused time", () => {
    const { controller, events } = makeController();
    controller.track("a");
    vi.advanceTimersByTime(2000);
    controller.pause("a");
    vi.advanceTimersByTime(5000); // hovered for 5s — nothing fires
    expect(events).toEqual([]);
    controller.resume("a");
    vi.advanceTimersByTime(3000 - 1);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1); // the remaining 3s count from the resume instant
    expect(events).toEqual([{ id: "a", event: "exit", at: 10000 }]); // 2s visible + 5s paused + 3s remaining
    controller.destroy();
  });

  it("swipe too short: spring-back resume keeps counting the remaining time", () => {
    const { controller, events } = makeController();
    controller.track("a");
    vi.advanceTimersByTime(4000);
    controller.pause("a"); // pointer down
    vi.advanceTimersByTime(1000); // dragged for 1s, swipe rejected
    controller.resume("a"); // spring back — 1s remaining
    vi.advanceTimersByTime(999);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events.map((e) => e.event)).toEqual(["exit"]);
    controller.destroy();
  });

  it("destroy (unmount) leaves no dangling timers", () => {
    const { controller, events } = makeController();
    controller.track("a");
    controller.track("b");
    vi.advanceTimersByTime(1000);
    controller.dismiss("b"); // exit animation timer now pending too
    controller.destroy();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(events.filter((e) => e.id === "a")).toEqual([]);
    expect(events.filter((e) => e.id === "b").length).toBeLessThanOrEqual(1); // exit started before destroy
  });

  it("destroyed controller ignores every further call", () => {
    const { controller, events } = makeController();
    controller.destroy();
    controller.track("a");
    controller.dismiss("a");
    controller.pause("a");
    controller.resume("a");
    vi.advanceTimersByTime(60_000);
    expect(events).toEqual([]);
  });
});
