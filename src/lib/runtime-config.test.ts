import { describe, expect, it } from "vitest";
import { getProductionConfigIssues } from "@/lib/runtime-config";

describe("production configuration", () => {
  it("requires auth and database configuration in production", () => {
    expect(getProductionConfigIssues({ NODE_ENV: "production" })).toEqual([
      "AUTH_SECRET",
      "DATABASE_URL",
    ]);
  });

  it("accepts valid production configuration", () => {
    expect(getProductionConfigIssues({
      NODE_ENV: "production",
      AUTH_SECRET: "a".repeat(32),
      DATABASE_URL: "file:./production.db",
    })).toEqual([]);
  });

  it("allows local defaults outside production", () => {
    expect(getProductionConfigIssues({ NODE_ENV: "development" })).toEqual([]);
  });
});
