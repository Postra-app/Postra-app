-- A used promise holds the person's email and points at the organization it
-- went to. Deleting the account deleted the organization and left the promise
-- behind, address included, with no end date. It now goes with
-- the organization. Promises already left behind by a deleted organization
-- are removed first, or the constraint could not be added.
DELETE FROM "PendingGrant" g
 WHERE g."organizationId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o."id" = g."organizationId");

CREATE INDEX "PendingGrant_organizationId_idx" ON "PendingGrant"("organizationId");

ALTER TABLE "PendingGrant" ADD CONSTRAINT "PendingGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
