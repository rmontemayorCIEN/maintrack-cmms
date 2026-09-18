-- Estado operativo separado del comercial (Bloque 4): quién declaró que la
-- empresa empieza a operar. Aditiva: columna nula; ninguna empresa existente
-- cambia de estado.
-- Reversion:
--   ALTER TABLE "Organization" DROP COLUMN "operandoPorId";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "operandoPorId" TEXT;

