-- AlterTable
ALTER TABLE "WorkOrderTask" ADD COLUMN     "laborCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "partsCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "serviceCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "WorkOrderLabor" ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "WorkOrderPart" ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "WorkOrderService" ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "WorkOrderLabor_taskId_idx" ON "WorkOrderLabor"("taskId");

-- CreateIndex
CREATE INDEX "WorkOrderPart_taskId_idx" ON "WorkOrderPart"("taskId");

-- CreateIndex
CREATE INDEX "WorkOrderService_taskId_idx" ON "WorkOrderService"("taskId");

-- AddForeignKey
ALTER TABLE "WorkOrderLabor" ADD CONSTRAINT "WorkOrderLabor_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkOrderTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderPart" ADD CONSTRAINT "WorkOrderPart_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkOrderTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderService" ADD CONSTRAINT "WorkOrderService_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkOrderTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

