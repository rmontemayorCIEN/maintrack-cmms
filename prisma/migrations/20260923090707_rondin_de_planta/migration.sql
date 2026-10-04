-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "rdSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "rondinParadaId" TEXT;

-- CreateTable
CREATE TABLE "Rondin" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "siteId" TEXT,
    "locationId" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'EN_CURSO',
    "iniciadoPorId" TEXT,
    "iniciadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminadoEn" TIMESTAMP(3),
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rondin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RondinParada" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rondinId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "reportPointId" TEXT,
    "assetId" TEXT,
    "locationId" TEXT,
    "comoSeIdentifico" TEXT NOT NULL DEFAULT 'NINGUNO',
    "observacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RondinParada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rondin_organizationId_idx" ON "Rondin"("organizationId");

-- CreateIndex
CREATE INDEX "Rondin_organizationId_estado_idx" ON "Rondin"("organizationId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Rondin_organizationId_numero_key" ON "Rondin"("organizationId", "numero");

-- CreateIndex
CREATE INDEX "RondinParada_organizationId_idx" ON "RondinParada"("organizationId");

-- CreateIndex
CREATE INDEX "RondinParada_rondinId_idx" ON "RondinParada"("rondinId");

-- CreateIndex
CREATE INDEX "RondinParada_organizationId_assetId_idx" ON "RondinParada"("organizationId", "assetId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_rondinParadaId_fkey" FOREIGN KEY ("rondinParadaId") REFERENCES "RondinParada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rondin" ADD CONSTRAINT "Rondin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rondin" ADD CONSTRAINT "Rondin_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rondin" ADD CONSTRAINT "Rondin_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rondin" ADD CONSTRAINT "Rondin_iniciadoPorId_fkey" FOREIGN KEY ("iniciadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinParada" ADD CONSTRAINT "RondinParada_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinParada" ADD CONSTRAINT "RondinParada_rondinId_fkey" FOREIGN KEY ("rondinId") REFERENCES "Rondin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinParada" ADD CONSTRAINT "RondinParada_reportPointId_fkey" FOREIGN KEY ("reportPointId") REFERENCES "ReportPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinParada" ADD CONSTRAINT "RondinParada_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinParada" ADD CONSTRAINT "RondinParada_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

