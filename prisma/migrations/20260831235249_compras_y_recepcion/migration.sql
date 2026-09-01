-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "comprasInternas" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "montoAutorizacion" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rcSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "materialRequestId" TEXT,
    "solicitanteId" TEXT,
    "proveedorSugeridoId" TEXT,
    "urgencia" TEXT NOT NULL DEFAULT 'NORMAL',
    "justificacion" TEXT,
    "montoEstimado" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ordenCompra" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'SOLICITADA',
    "autorizadaPorId" TEXT,
    "autorizadaEl" TIMESTAMP(3),
    "motivoRechazo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "partId" TEXT,
    "descripcion" TEXT NOT NULL,
    "cantidadSolicitada" DOUBLE PRECISION NOT NULL,
    "cantidadRecibida" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costoEstimado" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nota" TEXT,

    CONSTRAINT "PurchaseRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "purchaseRequestId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "supplierId" TEXT,
    "remision" TEXT,
    "ordenCompra" TEXT,
    "recibidoPorId" TEXT,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "requestLineId" TEXT,
    "partId" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "costoUnitario" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conforme" BOOLEAN NOT NULL DEFAULT true,
    "observacion" TEXT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRequest_organizationId_idx" ON "PurchaseRequest"("organizationId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_estado_idx" ON "PurchaseRequest"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_organizationId_folio_key" ON "PurchaseRequest"("organizationId", "folio");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_requestId_idx" ON "PurchaseRequestLine"("requestId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_organizationId_idx" ON "GoodsReceipt"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_organizationId_folio_key" ON "GoodsReceipt"("organizationId", "folio");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_receiptId_idx" ON "GoodsReceiptLine"("receiptId");

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_autorizadaPorId_fkey" FOREIGN KEY ("autorizadaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_proveedorSugeridoId_fkey" FOREIGN KEY ("proveedorSugeridoId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_recibidoPorId_fkey" FOREIGN KEY ("recibidoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

