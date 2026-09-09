-- Track password changes so existing JWT sessions can be rejected.
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" DATETIME;
