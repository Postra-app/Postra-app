-- Comps with an end date and a reason, and comps promised to an email before
-- its account exists (influencers: the plan is there the moment they sign
-- up). Additive: every existing subscription keeps empty comp fields.
ALTER TABLE "Subscription" ADD COLUMN     "compEndsAt" TIMESTAMP(3),
ADD COLUMN     "compReason" TEXT;

CREATE TABLE "PendingGrant" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "months" INTEGER,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "organizationId" TEXT,

    CONSTRAINT "PendingGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingGrant_email_idx" ON "PendingGrant"("email");

CREATE INDEX "Subscription_compEndsAt_idx" ON "Subscription"("compEndsAt");
