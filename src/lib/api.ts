import { AppError } from "@/lib/utils";

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof Error && e.message === "Unauthorized") {
    return Response.json({ error: "لطفاً وارد شوید" }, { status: 401 });
  }
  if (e instanceof Error && e.message === "Forbidden") {
    return Response.json({ error: "دسترسی لازم را ندارید" }, { status: 403 });
  }
  console.error("[api]", e);
  return Response.json({ error: "خطای غیرمنتظره رخ داد. چند لحظه دیگر تلاش کنید." }, { status: 500 });
}
