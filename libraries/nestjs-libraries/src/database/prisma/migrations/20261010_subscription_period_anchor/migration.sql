-- E2E-07-40: the AI allowance month follows Stripe's billing anchor. Additive:
-- the old image ignores the column; empty means "count from createdAt".
ALTER TABLE "Subscription" ADD COLUMN "periodAnchor" TIMESTAMP(3);
