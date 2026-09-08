import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/utils";
import {
  adminBuddySchema,
  auditLimitSchema,
  deleteUserIdSchema,
  historyQuerySchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  validate,
} from "@/lib/validators";

describe("API input validation hardening", () => {
  it("rejects invalid buddy sync payloads", () => {
    expect(() => validate(adminBuddySchema, { userId: "", buddyId: "u2", link: true })).toThrow(AppError);
    expect(() => validate(adminBuddySchema, { userId: "u1", buddyId: "u2", link: "yes" })).toThrow(AppError);
  });

  it("rejects malformed history query values", () => {
    expect(() => validate(historyQuerySchema, { userId: "u1", days: "0", status: "SCHEDULED" })).toThrow(AppError);
    expect(() => validate(historyQuerySchema, { userId: "   ", days: "30", status: "SCHEDULED,COMPLETED" })).toThrow(AppError);
  });

  it("rejects out-of-range audit limits", () => {
    expect(() => validate(auditLimitSchema, "600")).toThrow(AppError);
    expect(() => validate(auditLimitSchema, "0")).toThrow(AppError);
  });

  it("rejects invalid delete-user IDs", () => {
    expect(() => validate(deleteUserIdSchema, { id: "" })).toThrow(AppError);
    expect(() => validate(deleteUserIdSchema, { id: "   " })).toThrow(AppError);
  });

  it("bounds push subscription credentials and validates unsubscribe ownership input", () => {
    expect(() =>
      validate(pushSubscriptionSchema, {
        endpoint: "https://push.example.test/subscription",
        keys: { p256dh: "x".repeat(513), auth: "a" },
      }),
    ).toThrow(AppError);
    expect(() => validate(pushUnsubscribeSchema, { endpoint: "not-a-url" })).toThrow(AppError);
    expect(validate(pushUnsubscribeSchema, { endpoint: "https://push.example.test/subscription" })).toEqual({
      endpoint: "https://push.example.test/subscription",
    });
  });

  it("accepts valid security-safe payloads", () => {
    expect(validate(adminBuddySchema, { userId: "u1", buddyId: "u2", link: true })).toEqual({
      userId: "u1",
      buddyId: "u2",
      link: true,
    });
    expect(validate(historyQuerySchema, { userId: "u1", days: "30", status: "SCHEDULED,COMPLETED" })).toEqual({
      userId: "u1",
      days: 30,
      status: ["SCHEDULED", "COMPLETED"],
    });
    expect(validate(auditLimitSchema, "100")).toBe(100);
  });
});
