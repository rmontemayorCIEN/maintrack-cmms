-- AlterTable
ALTER TABLE "Attachment" DROP COLUMN "url",
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'DOCUMENT',
ADD COLUMN     "note" TEXT,
ADD COLUMN     "partId" TEXT,
ADD COLUMN     "storagePath" TEXT NOT NULL,
ADD COLUMN     "uploadedById" TEXT,
ADD COLUMN     "workRequestId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_workOrderId_idx" ON "Attachment"("workOrderId");

-- CreateIndex
CREATE INDEX "Attachment_assetId_idx" ON "Attachment"("assetId");

-- CreateIndex
CREATE INDEX "Attachment_workRequestId_idx" ON "Attachment"("workRequestId");

-- CreateIndex
CREATE INDEX "Attachment_partId_idx" ON "Attachment"("partId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_workRequestId_fkey" FOREIGN KEY ("workRequestId") REFERENCES "WorkRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

