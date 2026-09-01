-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "assetIntakeId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_assetIntakeId_idx" ON "Attachment"("assetIntakeId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_assetIntakeId_fkey" FOREIGN KEY ("assetIntakeId") REFERENCES "AssetIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

