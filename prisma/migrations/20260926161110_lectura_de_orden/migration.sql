-- AlterTable
ALTER TABLE "MeterReading" ADD COLUMN     "workOrderId" TEXT;

-- CreateIndex
CREATE INDEX "MeterReading_workOrderId_idx" ON "MeterReading"("workOrderId");

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

