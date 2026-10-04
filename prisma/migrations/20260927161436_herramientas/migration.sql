-- AlterTable
ALTER TABLE "Part" ADD COLUMN     "naturaleza" TEXT NOT NULL DEFAULT 'REFACCION';

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "autoservicio" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PartStock" ADD COLUMN     "enResguardo" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Resguardo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "entregadoPorId" TEXT,
    "entregadoEl" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estadoSalida" TEXT,
    "proposito" TEXT,
    "devueltoEl" TIMESTAMP(3),
    "recibidoPorId" TEXT,
    "estadoRegreso" TEXT,
    "motivoBaja" TEXT,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resguardo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Resguardo_organizationId_devueltoEl_idx" ON "Resguardo"("organizationId", "devueltoEl");

-- CreateIndex
CREATE INDEX "Resguardo_personaId_devueltoEl_idx" ON "Resguardo"("personaId", "devueltoEl");

-- CreateIndex
CREATE INDEX "Resguardo_partId_devueltoEl_idx" ON "Resguardo"("partId", "devueltoEl");

-- AddForeignKey
ALTER TABLE "Resguardo" ADD CONSTRAINT "Resguardo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resguardo" ADD CONSTRAINT "Resguardo_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resguardo" ADD CONSTRAINT "Resguardo_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resguardo" ADD CONSTRAINT "Resguardo_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resguardo" ADD CONSTRAINT "Resguardo_entregadoPorId_fkey" FOREIGN KEY ("entregadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resguardo" ADD CONSTRAINT "Resguardo_recibidoPorId_fkey" FOREIGN KEY ("recibidoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

