import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransientMessageBus, TRANSIENT_MESSAGE_MS } from "@/lib/use-transient";

/**
 * Transient feedback alerts (error / success / warning / rate-limit banners)
 * follow the same acceptance criteria as the in-app notification toasts:
 *  - auto-dismiss at most 5s after a message is shown
 *  - back-to-back messages each get their own fresh deadline; showing a new
 *    message replaces (never stacks) and cancels the previous message's timer
 *  - a dismissed/removed alert never reappears (cancelled timers never fire)
 *  - dismiss (×) is immediate and cancels the timer
 *  - teardown leaves no dangling setTimeout behind
 */
describe("TransientMessageBus (auto-dismiss alert lifecycle)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBus() {
    const messages: Array<string | ""> = [];
    const bus = new TransientMessageBus<string>((m) => messages.push(m));
    return { bus, messages };
  }

  it("auto-dismisses a shown alert after 5 seconds", () => {
    const { bus, messages } = makeBus();
    bus.show("درخواست‌های زیاد؛ لطفاً کمی صبر کنید");
    expect(messages).toEqual(["درخواست‌های زیاد؛ لطفاً کمی صبر کنید"]);
    vi.advanceTimersByTime(TRANSIENT_MESSAGE_MS - 1);
    expect(messages).toEqual(["درخواست‌های زیاد؛ لطفاً کمی صبر کنید"]);
    vi.advanceTimersByTime(1);
    expect(messages).toEqual(["درخواست‌های زیاد؛ لطفاً کمی صبر کنید", ""]);
    bus.destroy();
  });

  it("a second alert replaces the first and cancels its timer (no ghost reappear)", () => {
    const { bus, messages } = makeBus();
    bus.show("اولی");
    vi.advanceTimersByTime(1000);
    bus.show("دومی");
    expect(messages).toEqual(["اولی", "دومی"]);
    // Well past both deadlines: only the SECOND message auto-dismisses.
    vi.advanceTimersByTime(2 * TRANSIENT_MESSAGE_MS);
    expect(messages).toEqual(["اولی", "دومی", ""]);
    bus.destroy();
  });

  it("a repeated identical message is a NEW occurrence with its own 5s deadline", () => {
    const { bus, messages } = makeBus();
    bus.show("خطا");
    vi.advanceTimersByTime(3000);
    bus.show("خطا"); // e.g. user retried and hit the same error again
    expect(messages).toEqual(["خطا", "خطا"]);
    vi.advanceTimersByTime(2000); // 5s total since the FIRST show — no dismiss yet
    expect(messages).toEqual(["خطا", "خطا"]);
    vi.advanceTimersByTime(3000); // 5s after the re-show
    expect(messages).toEqual(["خطا", "خطا", ""]);
    bus.destroy();
  });

  it("showing an empty value only clears the slot (no timer is started)", () => {
    const { bus, messages } = makeBus();
    bus.show("پیام");
    bus.show("");
    expect(messages).toEqual(["پیام", ""]);
    vi.advanceTimersByTime(TRANSIENT_MESSAGE_MS * 3);
    expect(messages).toEqual(["پیام", ""]);
    bus.destroy();
  });

  it("manual dismiss (×) clears immediately and cancels the auto-dismiss deadline", () => {
    const { bus, messages } = makeBus();
    bus.show("هشدار");
    vi.advanceTimersByTime(2000);
    bus.dismiss();
    expect(messages).toEqual(["هشدار", ""]);
    vi.advanceTimersByTime(TRANSIENT_MESSAGE_MS * 3);
    expect(messages).toEqual(["هشدار", ""]); // no late auto-dismiss after manual close
    bus.destroy();
  });

  it("dismiss only mutates the message slot — the caller's data is untouched", () => {
    const payload = { fromApi: { error: "خطا" } };
    const { bus, messages } = makeBus();
    bus.show(payload.fromApi.error);
    bus.dismiss();
    expect(messages).toEqual([payload.fromApi.error, ""]);
    expect(payload.fromApi.error).toBe("خطا"); // business state intact
    bus.destroy();
  });

  it("destroy (unmount) leaves no dangling timers and ignores later calls", () => {
    const { bus, messages } = makeBus();
    bus.show("الف");
    bus.show("ب");
    bus.destroy();
    expect(vi.getTimerCount()).toBe(0);
    bus.show("ج");
    bus.dismiss();
    vi.advanceTimersByTime(TRANSIENT_MESSAGE_MS * 3);
    expect(messages).toEqual(["الف", "ب"]);
  });

  it("object payloads (alert with kind) work transparently", () => {
    type Alert = { text: string; kind: "error" | "success" };
    const received: Array<Alert | ""> = [];
    const bus = new TransientMessageBus<Alert>((m) => received.push(m));
    bus.show({ text: "ذخیره شد ✓", kind: "success" });
    expect(received).toEqual([{ text: "ذخیره شد ✓", kind: "success" }]);
    vi.advanceTimersByTime(TRANSIENT_MESSAGE_MS);
    expect(received).toEqual([{ text: "ذخیره شد ✓", kind: "success" }, ""]);
    bus.destroy();
  });
});