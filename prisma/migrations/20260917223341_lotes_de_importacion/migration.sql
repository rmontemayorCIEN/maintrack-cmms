-- Puesta en marcha y calidad de datos (Bloque 4): lotes de importacion
-- trazables y reversibles, RFC del proveedor, y el arranque de operacion.
-- Aditiva: dos tablas nuevas y columnas nulas o con valor por omision.
-- Reversion:
--   DROP TABLE "ImportRecord";
--   DROP TABLE "ImportBatch";
--   ALTER TABLE "Supplier" DROP COLUMN "rfc";
--   ALTER TABLE "Organization" DROP COLUMN "operandoDesde", DROP COLUMN "modulosPuesta";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "modulosPuesta" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "operandoDesde" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "rfc" TEXT;

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "tipo" TEXT NOT NULL,
    "archivoNombre" TEXT,
    "archivoHuella" TEXT,
    "estado" TEXT NOT NULL,
    "leidos" INTEGER NOT NULL DEFAULT 0,
    "creados" INTEGER NOT NULL DEFAULT 0,
    "actualizados" INTEGER NOT NULL DEFAULT 0,
    "omitidos" INTEGER NOT NULL DEFAULT 0,
    "rechazados" INTEGER NOT NULL DEFAULT 0,
    "detalle" TEXT NOT NULL DEFAULT '{}',
    "revertidoAt" TIMESTAMP(3),
    "revertidoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "antes" TEXT,

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_organizationId_createdAt_idx" ON "ImportBatch"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRecord_batchId_idx" ON "ImportRecord"("batchId");

-- CreateIndex
CREATE INDEX "ImportRecord_entity_entityId_idx" ON "ImportRecord"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

