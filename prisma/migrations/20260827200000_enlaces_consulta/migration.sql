-- CreateTable
CREATE TABLE "ReferenceLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT,
    "partId" TEXT,
    "planId" TEXT,
    "createdById" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReferenceLink_organizationId_idx" ON "ReferenceLink"("organizationId");

-- CreateIndex
CREATE INDEX "ReferenceLink_assetId_idx" ON "ReferenceLink"("assetId");

-- CreateIndex
CREATE INDEX "ReferenceLink_partId_idx" ON "ReferenceLink"("partId");

-- CreateIndex
CREATE INDEX "ReferenceLink_planId_idx" ON "ReferenceLink"("planId");

-- AddForeignKey
ALTER TABLE "ReferenceLink" ADD CONSTRAINT "ReferenceLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceLink" ADD CONSTRAINT "ReferenceLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceLink" ADD CONSTRAINT "ReferenceLink_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceLink" ADD CONSTRAINT "ReferenceLink_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MaintenancePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceLink" ADD CONSTRAINT "ReferenceLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

