import { z } from "zod";
import { AppError } from "@/lib/utils";

/**
 * Central request validation. Zod schemas describe every mutating endpoint;
 * `validate()` turns failures into Persian AppErrors (HTTP 400).
 */

const id = z.string().min(1).max(64);

export const roleSchema = z.enum(["EMPLOYEE", "SUPERVISOR", "ADMIN"]);

const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "منطقه زمانی نامعتبر است" },
);

export const settingsSchema = z.object({
  workDurationMinutes: z.number().int().min(10).max(480),
  breakDurationMinutes: z.number().int().min(5).max(60),
  maxConcurrentBreaks: z.number().int().min(1).max(50),
  earlyNotificationMinutes: z.number().int().min(1).max(30),
  endNotificationMinutes: z.number().int().min(1).max(30),
  timezone: timezoneSchema,
  groupBreakEnabled: z.boolean(),
  groupSuggestWindowMinutes: z.number().int().min(3).max(30),
  maxGroupBreakLoadRatio: z.number().min(0.1).max(0.6),
});

/** Settings updates may be partial; present fields are fully validated. */
export const settingsUpdateSchema = settingsSchema.partial();

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "نام باید حداقل ۲ کاراکتر باشد").max(60),
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_.]{3,30}$/, "نام کاربری باید ۳ تا ۳۰ کاراکتر انگلیسی/عدد باشد"),
  password: z.string().min(6, "رمز عبور باید حداقل ۶ کاراکتر باشد").max(72),
  role: roleSchema.default("EMPLOYEE"),
});

export const updateUserRoleSchema = z.object({
  id,
  role: roleSchema,
});

export const overrideSchema = z.object({
  userId: id,
  action: z.enum(["start", "return", "end-shift"]),
});

export const adminBreakSchema = z.object({
  breakId: id,
  action: z.enum(["extend", "cancel"]),
  minutes: z.number().int().min(1, "مدت تمدید باید بین ۱ تا ۱۲۰ دقیقه باشد").max(120).default(5),
});

export const grantSchema = z.object({
  userId: id,
  amount: z
    .number()
    .int("مقدار امتیاز باید عدد صحیح باشد")
    .refine((v) => v !== 0 && Math.abs(v) <= 1000, "مقدار امتیاز باید بین ۱ تا ۱۰۰۰ (یا منفی تا کسر) باشد"),
  reason: z.string().trim().min(1, "دلیل الزامی است").max(100).default("MANUAL"),
});

export const rewardSchema = z.object({
  name: z.string().trim().min(2, "نام پاداش الزامی است").max(60),
  description: z.string().trim().max(200).optional().nullable(),
  coinCost: z.number().int().min(1, "هزینه پاداش باید حداقل ۱ سکه باشد").max(100_000),
  limitCount: z.number().int().min(1).max(1000).nullable().optional(),
});

export const announcementSchema = z.object({
  message: z.string().trim().min(1, "متن اطلاعیه الزامی است").max(500),
  targetUserIds: z.array(id).max(50).optional(),
});

export const redeemSchema = z.object({ rewardId: id });

export const buddyRequestSchema = z.object({ addresseeId: id });

export const buddyRespondSchema = z.object({ requestId: id, accept: z.boolean() });

export const buddyRemoveSchema = z.object({ buddyId: id });

export const callStatusSchema = z.object({
  onCall: z.boolean(),
  userId: id.optional(),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url("آدرس اشتراک نامعتبر است").max(500),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** Parse with a schema or throw a 400 AppError carrying the first issue. */
export function validate<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(issue?.message || "درخواست نامعتبر است", 400);
  }
  return result.data;
}
