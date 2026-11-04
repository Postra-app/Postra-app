-- The timezone a user picked in Settings (an IANA name). Empty means the
-- browser's own timezone, so every existing row keeps today's behaviour.
-- Additive.
ALTER TABLE "User" ADD COLUMN "timezoneName" TEXT;
