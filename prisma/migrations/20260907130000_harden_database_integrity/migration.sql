-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Preserve historical rows while repairing references that predate these
-- foreign keys. Relationship rows without valid parents are not usable and
-- are removed; historical records retain their content with a NULL owner.
UPDATE "Announcement"
SET "authorId" = NULL
WHERE "authorId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "Announcement"."authorId");
UPDATE "AuditLog"
SET "userId" = NULL
WHERE "userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "AuditLog"."userId");
UPDATE "CoinTransaction"
SET "userId" = NULL
WHERE "userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "CoinTransaction"."userId");
UPDATE "RewardRedemption"
SET "userId" = NULL
WHERE "userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "RewardRedemption"."userId");
UPDATE "GroupBreak"
SET "createdById" = NULL
WHERE "createdById" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "GroupBreak"."createdById");
UPDATE "Break"
SET "groupBreakId" = NULL
WHERE "groupBreakId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "GroupBreak" WHERE "GroupBreak"."id" = "Break"."groupBreakId");
DELETE FROM "AnnouncementRead"
WHERE NOT EXISTS (SELECT 1 FROM "Announcement" WHERE "Announcement"."id" = "AnnouncementRead"."announcementId")
   OR NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "AnnouncementRead"."userId");
DELETE FROM "GroupBreakMember"
WHERE NOT EXISTS (SELECT 1 FROM "GroupBreak" WHERE "GroupBreak"."id" = "GroupBreakMember"."groupBreakId")
   OR NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "GroupBreakMember"."userId");
DELETE FROM "BuddyRequest"
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "BuddyRequest"."requesterId")
   OR NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "BuddyRequest"."addresseeId");
DELETE FROM "BuddyLink"
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "BuddyLink"."aId")
   OR NOT EXISTS (SELECT 1 FROM "User" WHERE "User"."id" = "BuddyLink"."bId");

CREATE TABLE "new_Announcement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorId" TEXT,
    "message" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "targetUserIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Announcement" ("audience", "authorId", "createdAt", "id", "message", "targetUserIds") SELECT "audience", "authorId", "createdAt", "id", "message", "targetUserIds" FROM "Announcement";
DROP TABLE "Announcement";
ALTER TABLE "new_Announcement" RENAME TO "Announcement";
CREATE INDEX "Announcement_authorId_createdAt_idx" ON "Announcement"("authorId", "createdAt");
CREATE TABLE "new_AnnouncementRead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnnouncementRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AnnouncementRead" ("announcementId", "id", "readAt", "userId") SELECT "announcementId", "id", "readAt", "userId" FROM "AnnouncementRead";
DROP TABLE "AnnouncementRead";
ALTER TABLE "new_AnnouncementRead" RENAME TO "AnnouncementRead";
CREATE INDEX "AnnouncementRead_userId_idx" ON "AnnouncementRead"("userId");
CREATE UNIQUE INDEX "AnnouncementRead_announcementId_userId_key" ON "AnnouncementRead"("announcementId", "userId");
CREATE TABLE "new_AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AuditLog" ("action", "createdAt", "details", "id", "userId") SELECT "action", "createdAt", "details", "id", "userId" FROM "AuditLog";
DROP TABLE "AuditLog";
ALTER TABLE "new_AuditLog" RENAME TO "AuditLog";
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
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
    "notifiedEarlyAt" DATETIME,
    "notifiedEndWarnAt" DATETIME,
    "notifiedOverdueAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Break_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Break_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Break_groupBreakId_fkey" FOREIGN KEY ("groupBreakId") REFERENCES "GroupBreak" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Break" ("actualEnd", "actualStart", "breakIndex", "createdAt", "durationMinutes", "endDelayMinutes", "extendMinutes", "groupBreakId", "id", "notifiedEarlyAt", "notifiedEndWarnAt", "notifiedOverdueAt", "scheduledEnd", "scheduledStart", "shiftId", "startDelayMinutes", "status", "updatedAt", "userId") SELECT "actualEnd", "actualStart", "breakIndex", "createdAt", "durationMinutes", "endDelayMinutes", "extendMinutes", "groupBreakId", "id", "notifiedEarlyAt", "notifiedEndWarnAt", "notifiedOverdueAt", "scheduledEnd", "scheduledStart", "shiftId", "startDelayMinutes", "status", "updatedAt", "userId" FROM "Break";
DROP TABLE "Break";
ALTER TABLE "new_Break" RENAME TO "Break";
CREATE INDEX "Break_shiftId_idx" ON "Break"("shiftId");
CREATE INDEX "Break_userId_status_idx" ON "Break"("userId", "status");
CREATE INDEX "Break_scheduledStart_scheduledEnd_idx" ON "Break"("scheduledStart", "scheduledEnd");
CREATE INDEX "Break_groupBreakId_idx" ON "Break"("groupBreakId");
CREATE TABLE "new_BuddyLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aId" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuddyLink_aId_fkey" FOREIGN KEY ("aId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BuddyLink_bId_fkey" FOREIGN KEY ("bId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BuddyLink" ("aId", "bId", "createdAt", "id") SELECT "aId", "bId", "createdAt", "id" FROM "BuddyLink";
DROP TABLE "BuddyLink";
ALTER TABLE "new_BuddyLink" RENAME TO "BuddyLink";
CREATE INDEX "BuddyLink_aId_idx" ON "BuddyLink"("aId");
CREATE INDEX "BuddyLink_bId_idx" ON "BuddyLink"("bId");
Pragma writable_schema=1;
CREATE UNIQUE INDEX "sqlite_autoindex_BuddyLink_2" ON "BuddyLink"("aId", "bId");
Pragma writable_schema=0;
CREATE TABLE "new_BuddyRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    CONSTRAINT "BuddyRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BuddyRequest_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BuddyRequest" ("addresseeId", "createdAt", "id", "requesterId", "respondedAt", "status") SELECT "addresseeId", "createdAt", "id", "requesterId", "respondedAt", "status" FROM "BuddyRequest";
DROP TABLE "BuddyRequest";
ALTER TABLE "new_BuddyRequest" RENAME TO "BuddyRequest";
CREATE INDEX "BuddyRequest_requesterId_status_idx" ON "BuddyRequest"("requesterId", "status");
CREATE INDEX "BuddyRequest_addresseeId_status_idx" ON "BuddyRequest"("addresseeId", "status");
Pragma writable_schema=1;
CREATE UNIQUE INDEX "sqlite_autoindex_BuddyRequest_2" ON "BuddyRequest"("requesterId", "addresseeId");
Pragma writable_schema=0;
CREATE TABLE "new_CoinTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "amount" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CoinTransaction" ("amount", "createdAt", "id", "reason", "type", "userId") SELECT "amount", "createdAt", "id", "reason", "type", "userId" FROM "CoinTransaction";
DROP TABLE "CoinTransaction";
ALTER TABLE "new_CoinTransaction" RENAME TO "CoinTransaction";
CREATE INDEX "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");
CREATE TABLE "new_GroupBreak" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'FORMING',
    "createdById" TEXT,
    "startedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupBreak_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GroupBreak" ("createdAt", "createdById", "id", "startedAt", "status") SELECT "createdAt", "createdById", "id", "startedAt", "status" FROM "GroupBreak";
DROP TABLE "GroupBreak";
ALTER TABLE "new_GroupBreak" RENAME TO "GroupBreak";
CREATE INDEX "GroupBreak_createdById_status_idx" ON "GroupBreak"("createdById", "status");
CREATE TABLE "new_GroupBreakMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupBreakId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readyAt" DATETIME,
    CONSTRAINT "GroupBreakMember_groupBreakId_fkey" FOREIGN KEY ("groupBreakId") REFERENCES "GroupBreak" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupBreakMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GroupBreakMember" ("groupBreakId", "id", "readyAt", "userId") SELECT "groupBreakId", "id", "readyAt", "userId" FROM "GroupBreakMember";
DROP TABLE "GroupBreakMember";
ALTER TABLE "new_GroupBreakMember" RENAME TO "GroupBreakMember";
CREATE INDEX "GroupBreakMember_userId_idx" ON "GroupBreakMember"("userId");
Pragma writable_schema=1;
CREATE UNIQUE INDEX "sqlite_autoindex_GroupBreakMember_2" ON "GroupBreakMember"("groupBreakId", "userId");
Pragma writable_schema=0;
CREATE TABLE "new_RewardRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rewardId" TEXT NOT NULL,
    "userId" TEXT,
    "coinSpent" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RewardRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RewardRedemption" ("coinSpent", "createdAt", "id", "rewardId", "userId") SELECT "coinSpent", "createdAt", "id", "rewardId", "userId" FROM "RewardRedemption";
DROP TABLE "RewardRedemption";
ALTER TABLE "new_RewardRedemption" RENAME TO "RewardRedemption";
CREATE INDEX "RewardRedemption_userId_idx" ON "RewardRedemption"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
