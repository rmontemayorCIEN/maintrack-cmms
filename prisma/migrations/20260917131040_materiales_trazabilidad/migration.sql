-- Trazabilidad de materiales (Bloque 2): devolucion que corrige el consumo,
-- faltante ligado a su compra, y recepcion a prueba de doble clic.
-- Aditiva: columnas nuevas nulas o con valor por omision.
-- Reversion:
--   DROP INDEX "GoodsReceipt_organizationId_clave_key";
--   DROP INDEX "PurchaseRequestLine_materialRequestLineId_idx";
--   ALTER TABLE "PurchaseRequestLine" DROP CONSTRAINT "PurchaseRequestLine_materialRequestLineId_fkey";
--   ALTER TABLE "PurchaseRequestLine" DROP COLUMN "materialRequestLineId";
--   ALTER TABLE "WorkOrderPart" DROP COLUMN "devuelto";
--   ALTER TABLE "GoodsReceipt" DROP COLUMN "clave";

-- AlterTable
ALTER TABLE "WorkOrderPart" ADD COLUMN     "devuelto" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseRequestLine" ADD COLUMN     "materialRequestLineId" TEXT;

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "clave" TEXT;

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_materialRequestLineId_idx" ON "PurchaseRequestLine"("materialRequestLineId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_organizationId_clave_key" ON "GoodsReceipt"("organizationId", "clave");

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_materialRequestLineId_fkey" FOREIGN KEY ("materialRequestLineId") REFERENCES "MaterialRequestLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

