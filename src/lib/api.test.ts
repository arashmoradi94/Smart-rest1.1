import { describe, expect, it } from "vitest";
import { errorResponse } from "@/lib/api";
import { AppError } from "@/lib/utils";

async function json(response: Response) {
  return response.json() as Promise<{ error: string }>;
}

describe("API error responses", () => {
  it("preserves safe application errors and status codes", async () => {
    const response = errorResponse(new AppError("درخواست نامعتبر است", 400));
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "درخواست نامعتبر است" });
  });

  it.each([
    ["P2002", 409],
    ["P2003", 409],
    ["P2025", 404],
  ])("maps Prisma %s without exposing database details", async (code, status) => {
    const error = Object.assign(new Error(`PrismaClientKnownRequestError: ${code} secret schema detail`), { code });
    const response = errorResponse(error);
    const body = await json(response);
    expect(response.status).toBe(status);
    expect(body.error).not.toContain("Prisma");
    expect(body.error).not.toContain("schema");
    expect(body.error).not.toContain("secret");
  });

  it("returns a safe 500 for unexpected errors", async () => {
    const response = errorResponse(new Error("database path and stack details"));
    const body = await json(response);
    expect(response.status).toBe(500);
    expect(body.error).toBe("خطای غیرمنتظره رخ داد. چند لحظه دیگر تلاش کنید.");
    expect(body.error).not.toContain("database");
  });
});
