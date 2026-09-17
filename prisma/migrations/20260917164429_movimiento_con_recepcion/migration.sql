-- El movimiento de almacen recuerda de que recepcion vino (Bloque 2).
-- Aditiva: columna nula. Los movimientos anteriores se quedan sin recepcion y
-- el kardex los sigue mostrando con su referencia de texto; no se adivina nada.
-- Reversion:
--   ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_goodsReceiptId_fkey";
--   ALTER TABLE "StockMovement" DROP COLUMN "goodsReceiptId";

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "goodsReceiptId" TEXT;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

