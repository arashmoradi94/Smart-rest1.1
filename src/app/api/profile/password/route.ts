import { requireAuth } from "@/lib/auth";
import { errorResponse, limit, readJson } from "@/lib/api";
import { validate, passwordChangeSchema } from "@/lib/validators";
import { changeOwnPassword } from "@/services/profile-service";
import { AppError } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    limit(request, user.id, "write");
    if (!rateLimit(`password-change:${user.id}`, 5, 15 * 60_000).ok) {
      throw new AppError("تلاش‌های زیاد؛ لطفاً کمی بعد دوباره امتحان کنید", 429);
    }
    const { currentPassword, newPassword } = validate(passwordChangeSchema, await readJson(request));
    return Response.json(await changeOwnPassword(user.id, currentPassword, newPassword));
  } catch (e) {
    return errorResponse(e);
  }
}
