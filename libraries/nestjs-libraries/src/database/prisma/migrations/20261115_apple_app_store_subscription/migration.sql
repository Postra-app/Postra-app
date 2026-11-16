-- A plan billed by Apple is found by the purchase's original transaction id.
-- Additive: existing rows keep both columns empty.
ALTER TABLE "Subscription" ADD COLUMN "appleOriginalTransactionId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "appleSignedAt" TIMESTAMP(3);
-- End of the paid period (and grace period) Apple last reported, so a plan
-- whose expiry notification never arrives still ends.
ALTER TABLE "Subscription" ADD COLUMN "appleExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Subscription_appleOriginalTransactionId_key" ON "Subscription"("appleOriginalTransactionId");

-- Notifications already handled, so a redelivery is not applied twice.
CREATE TABLE "AppleProcessedNotification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppleProcessedNotification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AppleProcessedNotification_createdAt_idx" ON "AppleProcessedNotification"("createdAt");

-- Purchases Apple has reported as over, so a transaction signed before that
-- cannot be turned into a plan afterwards.
CREATE TABLE "AppleEndedPurchase" (
    "originalTransactionId" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppleEndedPurchase_pkey" PRIMARY KEY ("originalTransactionId")
);
