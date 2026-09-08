import { AppError } from "@/lib/utils";
import { clientKey, rateLimit } from "@/lib/rate-limit";

type PrismaErrorLike = Error & { code?: string };

function prismaErrorResponse(error: PrismaErrorLike): Response | undefined {
  if (error.code === "P2002") {
    return Response.json({ error: "این مورد از قبل وجود دارد" }, { status: 409 });
  }
  if (error.code === "P2025") {
    return Response.json({ error: "مورد درخواستی یافت نشد" }, { status: 404 });
  }
  if (error.code === "P2003") {
    return Response.json({ error: "این عملیات با وضعیت فعلی داده‌ها سازگار نیست" }, { status: 409 });
  }
  return undefined;
}

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
  if (e instanceof Error) {
    const databaseResponse = prismaErrorResponse(e as PrismaErrorLike);
    if (databaseResponse) return databaseResponse;
    console.error("[api]", e.name, e.message);
  } else {
    console.error("[api] unexpected non-error throw");
  }
  return Response.json({ error: "خطای غیرمنتظره رخ داد. چند لحظه دیگر تلاش کنید." }, { status: 500 });
}

const WRITE_LIMIT = 20; // per minute per user for state-changing actions
const READ_LIMIT = 120; // per minute for polling endpoints

/** Rate-limit guard for API handlers. Throws 429 AppError when exceeded. */
export function limit(request: Request, userId?: string, kind: "read" | "write" = "write") {
  const { ok } = rateLimit(
    clientKey(request, userId),
    kind === "read" ? READ_LIMIT : WRITE_LIMIT,
    60_000,
  );
  if (!ok) {
    throw new AppError("درخواست‌های زیاد؛ لطفاً کمی صبر کنید", 429);
  }
}

/** Parse and validate a JSON body with a size cap. */
export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const raw = await request.text();
  if (raw.length > 10_000) throw new AppError("بدنه درخواست بیش از حد بزرگ است", 413);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new AppError("بدنه درخواست نامعتبر است", 400);
  }
}
