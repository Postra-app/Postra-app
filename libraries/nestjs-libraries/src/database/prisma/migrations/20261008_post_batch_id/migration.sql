-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE INDEX "Post_batchId_idx" ON "Post"("batchId");
