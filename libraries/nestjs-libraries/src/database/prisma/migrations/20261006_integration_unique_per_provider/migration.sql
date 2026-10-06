-- DropIndex
DROP INDEX "Integration_organizationId_internalId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Integration_organizationId_providerIdentifier_internalId_key" ON "Integration"("organizationId", "providerIdentifier", "internalId");
