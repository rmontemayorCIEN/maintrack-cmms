-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "otDiasHabiles" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PlanTask" ADD COLUMN     "cadaCuanto" INTEGER,
ADD COLUMN     "unidadFrecuencia" TEXT NOT NULL DEFAULT 'DIAS';

-- CreateTable
CREATE TABLE "PlanTaskAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planTaskId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "arranqueEl" TIMESTAMP(3),
    "arranqueEsUltima" BOOLEAN NOT NULL DEFAULT true,
    "ultimaEl" TIMESTAMP(3),
    "proximaEl" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTaskAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanTaskAsset_organizationId_idx" ON "PlanTaskAsset"("organizationId");

-- CreateIndex
CREATE INDEX "PlanTaskAsset_assetId_idx" ON "PlanTaskAsset"("assetId");

-- CreateIndex
CREATE INDEX "PlanTaskAsset_proximaEl_idx" ON "PlanTaskAsset"("proximaEl");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTaskAsset_planTaskId_assetId_key" ON "PlanTaskAsset"("planTaskId", "assetId");

-- AddForeignKey
ALTER TABLE "PlanTaskAsset" ADD CONSTRAINT "PlanTaskAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskAsset" ADD CONSTRAINT "PlanTaskAsset_planTaskId_fkey" FOREIGN KEY ("planTaskId") REFERENCES "PlanTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTaskAsset" ADD CONSTRAINT "PlanTaskAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

