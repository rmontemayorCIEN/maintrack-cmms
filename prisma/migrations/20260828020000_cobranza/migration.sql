-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "invSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "importe" DOUBLE PRECISION NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'MXN',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "emitidaEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "venceEl" TIMESTAMP(3) NOT NULL,
    "pagadaEl" TIMESTAMP(3),
    "formaPago" TEXT,
    "referenciaPago" TEXT,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_periodo_key" ON "Invoice"("organizationId", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_folio_key" ON "Invoice"("organizationId", "folio");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

