-- E2E-02-17: a redeemed lifetime code outlives the organisation, so it cannot
-- be redeemed again after the account is deleted. Additive: the old image
-- reads the column the same way.
-- DropForeignKey
ALTER TABLE "UsedCodes" DROP CONSTRAINT "UsedCodes_orgId_fkey";

-- AlterTable
ALTER TABLE "UsedCodes" ALTER COLUMN "orgId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "UsedCodes" ADD CONSTRAINT "UsedCodes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
