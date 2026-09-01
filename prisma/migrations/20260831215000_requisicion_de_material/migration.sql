-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "rmSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "entregadoA" TEXT,
ADD COLUMN     "materialRequestId" TEXT;

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "assetId" TEXT,
    "solicitanteId" TEXT,
    "motivo" TEXT NOT NULL DEFAULT 'CORRECTIVO',
    "urgencia" TEXT NOT NULL DEFAULT 'NORMAL',
    "nota" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'SOLICITADA',
    "cerradaEl" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "partId" TEXT,
    "descripcion" TEXT NOT NULL,
    "cantidadSolicitada" DOUBLE PRECISION NOT NULL,
    "cantidadSurtida" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cantidadDevuelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nota" TEXT,

    CONSTRAINT "MaterialRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialRequest_organizationId_idx" ON "MaterialRequest"("organizationId");

-- CreateIndex
CREATE INDEX "MaterialRequest_warehouseId_idx" ON "MaterialRequest"("warehouseId");

-- CreateIndex
CREATE INDEX "MaterialRequest_workOrderId_idx" ON "MaterialRequest"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequest_organizationId_folio_key" ON "MaterialRequest"("organizationId", "folio");

-- CreateIndex
CREATE INDEX "MaterialRequestLine_requestId_idx" ON "MaterialRequestLine"("requestId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

