-- CreateTable
CREATE TABLE "Vigencia" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "folio" TEXT,
    "desde" TIMESTAMP(3),
    "hasta" TIMESTAMP(3),
    "avisarDias" INTEGER,
    "cubre" TEXT,
    "supplierId" TEXT,
    "assetId" TEXT,
    "partId" TEXT,
    "userId" TEXT,
    "serviceId" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "canceladaEl" TIMESTAMP(3),
    "nota" TEXT,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vigencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vigencia_organizationId_tipo_idx" ON "Vigencia"("organizationId", "tipo");

-- CreateIndex
CREATE INDEX "Vigencia_organizationId_hasta_idx" ON "Vigencia"("organizationId", "hasta");

-- CreateIndex
CREATE INDEX "Vigencia_assetId_idx" ON "Vigencia"("assetId");

-- CreateIndex
CREATE INDEX "Vigencia_supplierId_idx" ON "Vigencia"("supplierId");

-- AddForeignKey
ALTER TABLE "Vigencia" ADD CONSTRAINT "Vigencia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vigencia" ADD CONSTRAINT "Vigencia_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vigencia" ADD CONSTRAINT "Vigencia_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vigencia" ADD CONSTRAINT "Vigencia_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vigencia" ADD CONSTRAINT "Vigencia_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vigencia" ADD CONSTRAINT "Vigencia_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ExternalService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vigencia" ADD CONSTRAINT "Vigencia_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

