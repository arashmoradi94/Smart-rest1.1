-- AlterTable
ALTER TABLE "Break" ADD COLUMN "notifiedEarlyAt" DATETIME;
ALTER TABLE "Break" ADD COLUMN "notifiedEndWarnAt" DATETIME;
ALTER TABLE "Break" ADD COLUMN "notifiedOverdueAt" DATETIME;

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
