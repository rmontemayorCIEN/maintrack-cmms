-- Proceso operativo de OT (Bloque 1): motivos y excepciones justificadas.
-- Aditiva: columnas nulas o con valor por omision; no toca datos existentes.
-- Reversion:
--   ALTER TABLE "Organization" DROP COLUMN "otEvidenciaCriticas";
--   ALTER TABLE "WorkOrder" DROP COLUMN "motivoCancelacion", DROP COLUMN "motivoEspera",
--     DROP COLUMN "motivoSinDiagnostico", DROP COLUMN "motivoSinHoras", DROP COLUMN "sinParoConfirmado";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "otEvidenciaCriticas" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "motivoCancelacion" TEXT,
ADD COLUMN     "motivoEspera" TEXT,
ADD COLUMN     "motivoSinDiagnostico" TEXT,
ADD COLUMN     "motivoSinHoras" TEXT,
ADD COLUMN     "sinParoConfirmado" BOOLEAN NOT NULL DEFAULT false;

