import { describe, expect, it } from "vitest";
import { buildDinnerSlots } from "@/services/dinner-service";

describe("buildDinnerSlots", () => {
  it("creates contiguous 20-minute slots", () => {
    expect(buildDinnerSlots("19:40", "20:40")).toEqual([
      { startTime: "19:40", endTime: "20:00" },
      { startTime: "20:00", endTime: "20:20" },
      { startTime: "20:20", endTime: "20:40" },
    ]);
  });

  it("rejects ranges that are not a positive multiple of 20 minutes", () => {
    expect(() => buildDinnerSlots("20:00", "20:10")).toThrow();
    expect(() => buildDinnerSlots("20:00", "19:40")).toThrow();
  });

  it("rejects invalid clock values", () => {
    expect(() => buildDinnerSlots("25:00", "26:00")).toThrow();
  });
});
