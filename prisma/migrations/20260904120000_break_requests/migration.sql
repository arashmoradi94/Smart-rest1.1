-- BreakRequest: employee A asks same-shift employee B to take the break together.
-- @@unique([senderId, recipientId, status]) guards duplicate PENDING requests
-- while keeping the accepted/rejected history auditable.
CREATE TABLE "BreakRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    CONSTRAINT "BreakRequest_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BreakRequest_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BreakRequest_senderId_recipientId_status_key" ON "BreakRequest"("senderId", "recipientId", "status");
CREATE INDEX "BreakRequest_recipientId_status_createdAt_idx" ON "BreakRequest"("recipientId", "status", "createdAt");
CREATE INDEX "BreakRequest_senderId_status_createdAt_idx" ON "BreakRequest"("senderId", "status", "createdAt");
