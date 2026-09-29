-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "normaId" TEXT,
ADD COLUMN     "origenIa" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReferenceLink" ADD COLUMN     "normaId" TEXT,
ADD COLUMN     "origenIa" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Attachment_normaId_idx" ON "Attachment"("normaId");

-- CreateIndex
CREATE INDEX "ReferenceLink_normaId_idx" ON "ReferenceLink"("normaId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_normaId_fkey" FOREIGN KEY ("normaId") REFERENCES "NormaAdoptada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceLink" ADD CONSTRAINT "ReferenceLink_normaId_fkey" FOREIGN KEY ("normaId") REFERENCES "NormaAdoptada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

