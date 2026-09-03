ALTER TABLE "Break" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'REGULAR';
ALTER TABLE "Break" ADD COLUMN "emergencyReason" TEXT;
ALTER TABLE "Break" ADD COLUMN "emergencyNote" TEXT;
CREATE INDEX "Break_kind_status_idx" ON "Break"("kind", "status");

CREATE TABLE "DinnerSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'AUTO',
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 20,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "DinnerSchedule_monthKey_key" ON "DinnerSchedule"("monthKey");

CREATE TABLE "DinnerAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "allocation" TEXT NOT NULL DEFAULT 'AUTO',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DinnerAssignment_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "DinnerSchedule" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DinnerAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DinnerAssignment_scheduleId_userId_date_key" ON "DinnerAssignment"("scheduleId", "userId", "date");
CREATE INDEX "DinnerAssignment_userId_date_idx" ON "DinnerAssignment"("userId", "date");
