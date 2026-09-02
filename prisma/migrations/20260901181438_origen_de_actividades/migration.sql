-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "otHorizonteDias" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "otMultiOrigen" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "WorkOrderTask" ADD COLUMN     "maintenanceType" TEXT,
ADD COLUMN     "origen" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "origenPlanId" TEXT,
ADD COLUMN     "origenRequestId" TEXT,
ADD COLUMN     "planTaskId" TEXT;

