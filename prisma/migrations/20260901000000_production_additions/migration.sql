-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "targetUserIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AnnouncementRead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Break" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "breakIndex" INTEGER NOT NULL,
    "scheduledStart" DATETIME NOT NULL,
    "scheduledEnd" DATETIME NOT NULL,
    "actualStart" DATETIME,
    "actualEnd" DATETIME,
    "durationMinutes" INTEGER,
    "startDelayMinutes" INTEGER NOT NULL DEFAULT 0,
    "endDelayMinutes" INTEGER NOT NULL DEFAULT 0,
    "extendMinutes" INTEGER NOT NULL DEFAULT 0,
    "groupBreakId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Break_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Break_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Break" ("actualEnd", "actualStart", "breakIndex", "createdAt", "durationMinutes", "endDelayMinutes", "id", "scheduledEnd", "scheduledStart", "shiftId", "startDelayMinutes", "status", "updatedAt", "userId") SELECT "actualEnd", "actualStart", "breakIndex", "createdAt", "durationMinutes", "endDelayMinutes", "id", "scheduledEnd", "scheduledStart", "shiftId", "startDelayMinutes", "status", "updatedAt", "userId" FROM "Break";
DROP TABLE "Break";
ALTER TABLE "new_Break" RENAME TO "Break";
CREATE INDEX "Break_shiftId_idx" ON "Break"("shiftId");
CREATE INDEX "Break_userId_status_idx" ON "Break"("userId", "status");
CREATE INDEX "Break_scheduledStart_scheduledEnd_idx" ON "Break"("scheduledStart", "scheduledEnd");
CREATE INDEX "Break_groupBreakId_idx" ON "Break"("groupBreakId");
CREATE TABLE "new_GroupBreak" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'FORMING',
    "createdById" TEXT NOT NULL,
    "startedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_GroupBreak" ("createdAt", "id", "startedAt", "status", "createdById") SELECT "createdAt", "id", "startedAt", "status", COALESCE((SELECT m."userId" FROM "GroupBreakMember" m WHERE m."groupBreakId" = "GroupBreak"."id" LIMIT 1), '') FROM "GroupBreak";
DROP TABLE "GroupBreak";
ALTER TABLE "new_GroupBreak" RENAME TO "GroupBreak";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "onCall" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "lastShiftDate" DATETIME,
    "streakDays" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_User" ("createdAt", "id", "lastShiftDate", "level", "name", "passwordHash", "role", "status", "streakDays", "updatedAt", "username", "xp") SELECT "createdAt", "id", "lastShiftDate", "level", "name", "passwordHash", "role", "status", "streakDays", "updatedAt", "username", "xp" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AnnouncementRead_userId_idx" ON "AnnouncementRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_userId_key" ON "AnnouncementRead"("announcementId", "userId");

-- Backfill: preserve legacy announcements previously stored in AuditLog
INSERT INTO "Announcement" ("id", "authorId", "message", "audience", "targetUserIds", "createdAt")
SELECT 'ann-legacy-' || "rowid", "userId", "details", 'ALL', '[]', "createdAt"
FROM "AuditLog"
WHERE "action" = 'ANNOUNCEMENT' AND "details" IS NOT NULL AND "details" != '';

