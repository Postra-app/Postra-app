-- Secrets at rest (E2E-11-108): the organisation API key is matched on its
-- SHA-256 instead of a deterministic ciphertext. Additive; the backend fills
-- it for existing rows at start (secrets-upgrade.service.ts).
ALTER TABLE "Organization" ADD COLUMN "apiKeyHash" TEXT;

CREATE UNIQUE INDEX "Organization_apiKeyHash_key" ON "Organization"("apiKeyHash");
