import { describe, expect, it } from "vitest";
import { companyDayKey, previousCompanyDayKey } from "@/lib/time";
import { diffMinutes } from "@/lib/utils";

describe("timezone and absolute-time handling", () => {
  it("keeps duration absolute across spring-forward and fall-back transitions", () => {
    const springStart = new Date("2026-03-08T06:30:00.000Z");
    const springEnd = new Date("2026-03-08T07:30:00.000Z");
    const fallStart = new Date("2026-11-01T05:30:00.000Z");
    const fallEnd = new Date("2026-11-01T06:30:00.000Z");

    expect(diffMinutes(springEnd, springStart)).toBe(60);
    expect(diffMinutes(fallEnd, fallStart)).toBe(60);
    expect(companyDayKey(springStart, "America/New_York")).toBe("2026-03-08");
    expect(companyDayKey(fallEnd, "America/New_York")).toBe("2026-11-01");
  });

  it("uses the company calendar day for streak boundaries", () => {
    const now = new Date("2026-08-24T20:30:00.000Z");
    expect(companyDayKey(now, "Asia/Tehran")).toBe("2026-08-25");
    expect(previousCompanyDayKey("Asia/Tehran", now)).toBe("2026-08-24");
  });

  it("round-trips an absolute timestamp without shifting the instant", () => {
    const original = new Date("2026-09-08T06:13:42.123Z");
    const restored = new Date(original.toISOString());
    expect(restored.getTime()).toBe(original.getTime());
  });
});
