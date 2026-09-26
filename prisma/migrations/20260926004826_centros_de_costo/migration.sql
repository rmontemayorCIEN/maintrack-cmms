-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "centroDeCostoId" TEXT;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "centroDeCostoId" TEXT;

-- CreateTable
CREATE TABLE "CentroDeCosto" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descripcion" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentroDeCosto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CentroDeCosto_organizationId_idx" ON "CentroDeCosto"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CentroDeCosto_organizationId_code_key" ON "CentroDeCosto"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_centroDeCostoId_fkey" FOREIGN KEY ("centroDeCostoId") REFERENCES "CentroDeCosto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_centroDeCostoId_fkey" FOREIGN KEY ("centroDeCostoId") REFERENCES "CentroDeCosto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CentroDeCosto" ADD CONSTRAINT "CentroDeCosto_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

