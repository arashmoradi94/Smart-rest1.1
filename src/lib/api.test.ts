import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/utils";
import { errorResponse, limit } from "@/lib/api";

const RATE_LIMIT_MESSAGE = "درخواست‌های زیاد؛ لطفاً کمی صبر کنید";

describe("API error / rate-limit chain → transient alert text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errorResponse maps the 429 rate-limit AppError to the exact alert message", async () => {
    const res = errorResponse(new AppError(RATE_LIMIT_MESSAGE, 429));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: RATE_LIMIT_MESSAGE });
  });

  it("the write budget exhaustion throws the exact 429 message the client shows", () => {
    // The dashboard shows `d.error` from this response in its transient alert,
    // so the alert text is exactly RATE_LIMIT_MESSAGE and auto-dismisses via
    // the transient bus (covered by use-transient.test.ts).
    const req = new Request("http://localhost/api/shift/start");
    const uid = `u-${Math.random()}-${Date.now()}`;
    for (let i = 0; i < 20; i++) limit(req, uid, "write"); // WRITE_LIMIT = 20/min, all allowed
    expect(() => limit(req, uid, "write")).toThrowError(
      expect.objectContaining({ status: 429, message: RATE_LIMIT_MESSAGE }),
    );
  });

  it("unexpected server errors become a generic dismissible message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("boom"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBeTruthy();
    expect(errorSpy).toHaveBeenCalled();
  });
});