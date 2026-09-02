-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "diasHabiles" TEXT NOT NULL DEFAULT '1,2,3,4,5',
ADD COLUMN     "horasJornada" DOUBLE PRECISION NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "horasDisponibles" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DiaFestivo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "nombre" TEXT NOT NULL,
    "deLey" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiaFestivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiaFestivo_organizationId_idx" ON "DiaFestivo"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DiaFestivo_organizationId_fecha_key" ON "DiaFestivo"("organizationId", "fecha");

-- AddForeignKey
ALTER TABLE "DiaFestivo" ADD CONSTRAINT "DiaFestivo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiaFestivo" ADD CONSTRAINT "DiaFestivo_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

