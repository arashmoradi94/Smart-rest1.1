-- One break-request row per pair: re-invitations flip the resolved row back to
-- PENDING instead of creating duplicates (same convention as BuddyRequest).
DROP INDEX IF EXISTS "BreakRequest_senderId_recipientId_status_key";
CREATE UNIQUE INDEX "BreakRequest_senderId_recipientId_key" ON "BreakRequest"("senderId", "recipientId");
