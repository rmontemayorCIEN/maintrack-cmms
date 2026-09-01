-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "icSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "responsableId" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTO',
    "alcance" TEXT,
    "nota" TEXT,
    "abiertoEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoEl" TIMESTAMP(3),

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "cantidadSistema" DOUBLE PRECISION NOT NULL,
    "cantidadContada" DOUBLE PRECISION,
    "cantidadAlCerrar" DOUBLE PRECISION,
    "nota" TEXT,

    CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryCount_organizationId_idx" ON "InventoryCount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCount_organizationId_folio_key" ON "InventoryCount"("organizationId", "folio");

-- CreateIndex
CREATE INDEX "InventoryCountLine_countId_idx" ON "InventoryCountLine"("countId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountLine_countId_partId_key" ON "InventoryCountLine"("countId", "partId");

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

