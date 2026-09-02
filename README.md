# مدیریت استراحت کال‌سنتر (Smart Break)

Web App فارسی RTL، Mobile-First و PWA برای مدیریت خودکار چرخه ۶۰ دقیقه کار → ۱۰ دقیقه استراحت کارکنان کال‌سنتر. زمان‌ها Server-based هستند؛ Refresh، قطع اینترنت و تغییر ساعت Client روی محاسبات اثر نمی‌گذارد.

## امکانات

### کارمند
- Start/End Shift با زمان Server، Countdown، Break بعدی، Start Break / Return To Work، Timeline، گزارش پایان شیفت
- آمار روزانه/هفتگی/ماهانه، نشان‌ها (Badges)، Leaderboard روز/هفته/ماه، فروشگاه پاداش
- پنل Buddy: هم‌شیفتی‌ها، استراحت گروهی هم‌زمان با ظرفیت‌سنجی

### عملیات زنده (Real-time)
- به‌روزرسانی لحظه‌ای داشبوردها با **SSE** (`/api/events`) — polling فقط Fallback
- داشبورد مدیر: وضعیت زنده‌ی تیم، کارت ظرفیت استراحت، پیش‌بینی یک ساعت آینده، Override شروع/بازگشت/پایان شیفت، تمدید استراحت
- گزارش‌ها: تحلیل روز/هفته/ماه، ساعات اوج، عملکرد هر کارمند، **خروجی CSV**

### امنیت و نقش‌ها (RBAC)
- سه نقش: `EMPLOYEE` / `SUPERVISOR` / `ADMIN` + تغییر نقش از پنل (با حفاظت آخرین ادمین)
- **Audit Log** کامل: شیفت، استراحت، Override، تنظیمات، سکه/پاداش، Buddy، لاگین ناموفق، نقش‌ها — با نمایشگر رخدادها در پنل
- Rate limiting روی همه‌ی APIها + قفل تلاش ورود (۱۰ تلاش/۵ دقیقه برای هر نام کاربری)
- اعتبارسنجی **Zod** روی تمام endpointهای تغییردهنده + security headers

### Push و یادآورها
- Web Push با VAPID، پاک‌سازی خودکار اشتراک‌های مرده
- یادآورهای سمت سرور (شروع نزدیک، پایان نزدیک، اتمام) — حتی وقتی اپ باز نیست (Sweep هر ۳۰ ثانیه، Exactly-once)
- اعلان Override/تمدید/لغو به کارمندِ هدف

### Smart Scheduling
- توزیع عادلانه با سقف `maxConcurrentBreaks`، چک اتمیک ظرفیت در Transaction، چرخه بعدی لنگر به پایان واقعی استراحت قبلی

## اجرا (Local)
```bash
npm install
cp .env.example .env        # مقادیر را پر کنید
npm run db:generate
npx prisma migrate dev      # یا db push
npm run db:seed             # دستی — فقط Local/Test
npm run dev
```

حساب پیش‌فرض Seed: `admin/admin1234` (قبل از استفاده واقعی عوض کنید)

## Production (Render/Node)
```bash
npm run build   # Prisma generate در postinstall اجرا می‌شود
npm start       # Health check: /api/health
```
- دیتابیس: SQLite (`DATABASE_URL=file:./dev.db`). برای PostgreSQL باید provider و adapter در `src/lib/db.ts` عوض شود
- `AUTH_SECRET` و کلیدهای VAPID به‌صورت Environment Variable — هرگز Commit نشوند
- Seed در Production خودکار اجرا نمی‌شود؛ کاربر ادمین را یک‌بار دستی بسازید
- مهاجرت امن بدون حذف داده: `npx prisma migrate deploy`
- نکته‌ی Scale: SSE، rate limiter و reminder job تک‌نوده‌اند؛ برای چند نمونه Redis لازم است

## تست
```bash
npm test   # 52 تست: lifecycle + scheduler + gamification + reminders/validators/events
```
