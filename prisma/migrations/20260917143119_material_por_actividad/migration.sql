-- Material ligado a la ACTIVIDAD que lo necesita (Bloque 2).
-- Aditiva: columna nula; los vales historicos se quedan sin actividad y se
-- muestran como «Actividad no especificada». No se relaciona nada por adivinanza.
-- Reversion:
--   ALTER TABLE "MaterialRequestLine" DROP CONSTRAINT "MaterialRequestLine_taskId_fkey";
--   DROP INDEX "MaterialRequestLine_taskId_idx";
--   ALTER TABLE "MaterialRequestLine" DROP COLUMN "taskId";

-- AlterTable
ALTER TABLE "MaterialRequestLine" ADD COLUMN     "taskId" TEXT;

-- CreateIndex
CREATE INDEX "MaterialRequestLine_taskId_idx" ON "MaterialRequestLine"("taskId");

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkOrderTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

