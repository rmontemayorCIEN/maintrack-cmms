-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "sePresta" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Resguardo" ADD COLUMN     "assetId" TEXT,
ALTER COLUMN "partId" DROP NOT NULL,
ALTER COLUMN "warehouseId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Resguardo_assetId_devueltoEl_idx" ON "Resguardo"("assetId", "devueltoEl");

-- AddForeignKey
ALTER TABLE "Resguardo" ADD CONSTRAINT "Resguardo_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

