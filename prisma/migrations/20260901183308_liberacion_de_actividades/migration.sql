-- AlterTable
ALTER TABLE "WorkOrderTask" ADD COLUMN     "bloqueadaPorPartId" TEXT,
ADD COLUMN     "liberadaAt" TIMESTAMP(3),
ADD COLUMN     "liberadaPorId" TEXT,
ADD COLUMN     "motivoDetalle" TEXT,
ADD COLUMN     "motivoLiberacion" TEXT,
ADD COLUMN     "retomaDeTaskId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderTask_retomaDeTaskId_key" ON "WorkOrderTask"("retomaDeTaskId");

-- CreateIndex
CREATE INDEX "WorkOrderTask_liberadaAt_idx" ON "WorkOrderTask"("liberadaAt");

-- AddForeignKey
ALTER TABLE "WorkOrderTask" ADD CONSTRAINT "WorkOrderTask_liberadaPorId_fkey" FOREIGN KEY ("liberadaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderTask" ADD CONSTRAINT "WorkOrderTask_bloqueadaPorPartId_fkey" FOREIGN KEY ("bloqueadaPorPartId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderTask" ADD CONSTRAINT "WorkOrderTask_retomaDeTaskId_fkey" FOREIGN KEY ("retomaDeTaskId") REFERENCES "WorkOrderTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

