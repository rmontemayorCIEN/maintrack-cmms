-- DropIndex
DROP INDEX "WorkRequest_workOrderId_key";

-- AlterTable
ALTER TABLE "WorkOrderTask" ADD COLUMN     "downtimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failureCodeId" TEXT,
ADD COLUMN     "rootCauseId" TEXT;

-- AddForeignKey
ALTER TABLE "WorkOrderTask" ADD CONSTRAINT "WorkOrderTask_failureCodeId_fkey" FOREIGN KEY ("failureCodeId") REFERENCES "FailureCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderTask" ADD CONSTRAINT "WorkOrderTask_rootCauseId_fkey" FOREIGN KEY ("rootCauseId") REFERENCES "RootCause"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderTask" ADD CONSTRAINT "WorkOrderTask_origenRequestId_fkey" FOREIGN KEY ("origenRequestId") REFERENCES "WorkRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

