-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "seguridadLeidaEl" TIMESTAMP(3),
ADD COLUMN     "seguridadLeidaHuella" TEXT,
ADD COLUMN     "seguridadLeidaPorId" TEXT;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_seguridadLeidaPorId_fkey" FOREIGN KEY ("seguridadLeidaPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

