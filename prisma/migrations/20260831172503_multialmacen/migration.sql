-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "tsSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "transferId" TEXT,
ADD COLUMN     "warehouseId" TEXT;

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "responsableId" TEXT,
    "esGeneral" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartStock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minQuantity" DOUBLE PRECISION,
    "maxQuantity" DOUBLE PRECISION,
    "bin" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "origenId" TEXT NOT NULL,
    "destinoId" TEXT NOT NULL,
    "userId" TEXT,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Warehouse_organizationId_idx" ON "Warehouse"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_organizationId_code_key" ON "Warehouse"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PartStock_organizationId_idx" ON "PartStock"("organizationId");

-- CreateIndex
CREATE INDEX "PartStock_warehouseId_idx" ON "PartStock"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "PartStock_partId_warehouseId_key" ON "PartStock"("partId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockTransfer_organizationId_idx" ON "StockTransfer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_organizationId_folio_key" ON "StockTransfer"("organizationId", "folio");

-- CreateIndex
CREATE INDEX "StockTransferLine_transferId_idx" ON "StockTransferLine"("transferId");

-- CreateIndex
CREATE INDEX "StockMovement_warehouseId_idx" ON "StockMovement"("warehouseId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartStock" ADD CONSTRAINT "PartStock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartStock" ADD CONSTRAINT "PartStock_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartStock" ADD CONSTRAINT "PartStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_destinoId_fkey" FOREIGN KEY ("destinoId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────────────────────────────────────────────────────────────────────────
-- Mudanza de la existencia
--
-- Hasta aqui la migracion solo creo estructura. Sin lo que sigue, todas las
-- refacciones quedarian con existencia cero en un sistema que ya tenia saldos,
-- porque la verdad se mudo a PartStock y nadie la copio.
--
-- Ningun saldo cambia y ningun movimiento se pierde: todo lo que habia queda
-- atribuido a un Almacen General, que es como opera hoy la realidad de estas
-- cuentas. Crear el segundo almacen despues es un alta normal.
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Un almacen general por organizacion, incluidas las que aun no tienen
--    refacciones: lo van a necesitar en cuanto den de alta la primera.
INSERT INTO "Warehouse" ("id", "organizationId", "code", "name", "esGeneral", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, o."id", 'ALM-GEN', 'Almacen General', true, true, NOW(), NOW()
  FROM "Organization" o;

-- 2. La existencia de cada refaccion se muda al general.
--    El minimo y el maximo quedan nulos a proposito: nulo significa heredar el
--    de la refaccion, que es justo el comportamiento que habia antes.
INSERT INTO "PartStock" ("id", "organizationId", "partId", "warehouseId", "quantity", "minQuantity", "maxQuantity", "bin", "updatedAt")
SELECT gen_random_uuid()::text, p."organizationId", p."id", w."id",
       p."quantityOnHand", NULL, NULL, p."bin", NOW()
  FROM "Part" p
  JOIN "Warehouse" w
    ON w."organizationId" = p."organizationId"
   AND w."esGeneral" = true;

-- 3. El kardex historico queda atribuido al general, para que los movimientos
--    de antes de esta migracion sigan cuadrando contra un almacen concreto.
UPDATE "StockMovement" m
   SET "warehouseId" = w."id"
  FROM "Warehouse" w
 WHERE w."organizationId" = m."organizationId"
   AND w."esGeneral" = true;
