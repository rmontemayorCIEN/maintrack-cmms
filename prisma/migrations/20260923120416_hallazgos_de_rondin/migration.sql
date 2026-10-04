-- AlterTable
ALTER TABLE "Rondin" ADD COLUMN     "analizadoEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RondinHallazgo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rondinId" TEXT NOT NULL,
    "rondinParadaId" TEXT,
    "assetId" TEXT,
    "categoria" TEXT NOT NULL DEFAULT 'OTRO',
    "titulo" TEXT NOT NULL,
    "detalle" TEXT,
    "baseVisual" TEXT,
    "certeza" TEXT NOT NULL DEFAULT 'DUDOSO',
    "estado" TEXT NOT NULL DEFAULT 'PROPUESTO',
    "workRequestId" TEXT,
    "resueltoPorId" TEXT,
    "resueltoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RondinHallazgo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RondinHallazgo_organizationId_idx" ON "RondinHallazgo"("organizationId");

-- CreateIndex
CREATE INDEX "RondinHallazgo_rondinId_idx" ON "RondinHallazgo"("rondinId");

-- CreateIndex
CREATE INDEX "RondinHallazgo_organizationId_estado_idx" ON "RondinHallazgo"("organizationId", "estado");

-- AddForeignKey
ALTER TABLE "RondinHallazgo" ADD CONSTRAINT "RondinHallazgo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinHallazgo" ADD CONSTRAINT "RondinHallazgo_rondinId_fkey" FOREIGN KEY ("rondinId") REFERENCES "Rondin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinHallazgo" ADD CONSTRAINT "RondinHallazgo_rondinParadaId_fkey" FOREIGN KEY ("rondinParadaId") REFERENCES "RondinParada"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinHallazgo" ADD CONSTRAINT "RondinHallazgo_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinHallazgo" ADD CONSTRAINT "RondinHallazgo_workRequestId_fkey" FOREIGN KEY ("workRequestId") REFERENCES "WorkRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RondinHallazgo" ADD CONSTRAINT "RondinHallazgo_resueltoPorId_fkey" FOREIGN KEY ("resueltoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

