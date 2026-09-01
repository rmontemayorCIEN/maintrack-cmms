-- AlterTable
ALTER TABLE "WorkRequest" ADD COLUMN     "publicToken" TEXT,
ADD COLUMN     "reportPointId" TEXT,
ADD COLUMN     "reporterCelular" TEXT,
ADD COLUMN     "reporterCorreo" TEXT,
ADD COLUMN     "reporterNombre" TEXT;

-- CreateTable
CREATE TABLE "ReportPoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "siteId" TEXT,
    "locationId" TEXT,
    "assetId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "nota" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportPoint_token_key" ON "ReportPoint"("token");

-- CreateIndex
CREATE INDEX "ReportPoint_organizationId_idx" ON "ReportPoint"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkRequest_publicToken_key" ON "WorkRequest"("publicToken");

-- AddForeignKey
ALTER TABLE "WorkRequest" ADD CONSTRAINT "WorkRequest_reportPointId_fkey" FOREIGN KEY ("reportPointId") REFERENCES "ReportPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportPoint" ADD CONSTRAINT "ReportPoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportPoint" ADD CONSTRAINT "ReportPoint_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportPoint" ADD CONSTRAINT "ReportPoint_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportPoint" ADD CONSTRAINT "ReportPoint_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportPoint" ADD CONSTRAINT "ReportPoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

