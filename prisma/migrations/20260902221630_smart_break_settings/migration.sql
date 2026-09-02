-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "workDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "breakDurationMinutes" INTEGER NOT NULL DEFAULT 10,
    "maxConcurrentBreaks" INTEGER NOT NULL DEFAULT 5,
    "earlyNotificationMinutes" INTEGER NOT NULL DEFAULT 2,
    "endNotificationMinutes" INTEGER NOT NULL DEFAULT 2,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
    "groupBreakEnabled" BOOLEAN NOT NULL DEFAULT true,
    "groupSuggestWindowMinutes" INTEGER NOT NULL DEFAULT 10,
    "maxGroupBreakLoadRatio" REAL NOT NULL DEFAULT 0.3,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("breakDurationMinutes", "earlyNotificationMinutes", "endNotificationMinutes", "id", "maxConcurrentBreaks", "timezone", "updatedAt", "workDurationMinutes") SELECT "breakDurationMinutes", "earlyNotificationMinutes", "endNotificationMinutes", "id", "maxConcurrentBreaks", "timezone", "updatedAt", "workDurationMinutes" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

