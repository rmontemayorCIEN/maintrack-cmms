-- Cierre del Bloque 1 · Proyeccion suspendida en medidores con lectura invalida.
--
-- Solo agrega dos columnas (booleana con valor por omision y texto nulo). No
-- modifica datos: el recalculo de medidores las pone al dia.
--
-- Reversion: ALTER TABLE "Meter" DROP COLUMN "motivoSuspension", DROP COLUMN "proyeccionSuspendida";
-- y borrar el renglon de esta migracion en "_prisma_migrations".

-- AlterTable
ALTER TABLE "Meter" ADD COLUMN     "motivoSuspension" TEXT,
ADD COLUMN     "proyeccionSuspendida" BOOLEAN NOT NULL DEFAULT false;

