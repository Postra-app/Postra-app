-- An announcement is served to every signed-in session until somebody deletes
-- it by hand, so an outage notice outlives the outage. expiresAt lets the
-- banner stop itself.
--
-- deletedAt makes removal soft: the audit row recording who took it down still
-- points at a row that exists, and "delete something already deleted" stays a
-- 200 answering `deleted:false` rather than a 500 (E2E-09-26, E2E-09-46).
--
-- Both nullable, so every existing row means "never expires, not deleted",
-- which is exactly what those rows are today.

ALTER TABLE "Announcement" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "Announcement" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Announcement_deletedAt_createdAt_idx" ON "Announcement"("deletedAt", "createdAt");
