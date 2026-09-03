-- CreateTable
CREATE TABLE "PlanAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "meterId" TEXT,
    "nextDueDate" TIMESTAMP(3),
    "nextDueMeter" DOUBLE PRECISION,
    "lastGeneratedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanAsset_organizationId_idx" ON "PlanAsset"("organizationId");

-- CreateIndex
CREATE INDEX "PlanAsset_assetId_idx" ON "PlanAsset"("assetId");

-- CreateIndex
CREATE INDEX "PlanAsset_nextDueDate_idx" ON "PlanAsset"("nextDueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PlanAsset_planId_assetId_key" ON "PlanAsset"("planId", "assetId");

-- AddForeignKey
ALTER TABLE "PlanAsset" ADD CONSTRAINT "PlanAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanAsset" ADD CONSTRAINT "PlanAsset_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MaintenancePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanAsset" ADD CONSTRAINT "PlanAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanAsset" ADD CONSTRAINT "PlanAsset_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanAsset" ADD CONSTRAINT "PlanAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

