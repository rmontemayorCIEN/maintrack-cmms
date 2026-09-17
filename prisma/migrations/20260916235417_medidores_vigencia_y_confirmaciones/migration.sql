-- Bloque 1 · Cierre: vigencia de medidores, correccion de reinicios,
-- confirmacion de rutinas diarias y evidencia de resolucion de alertas.
--
-- Solo agrega columnas nulas o con valor por omision. No modifica datos.
--
-- Reversion (si hiciera falta):
--   ALTER TABLE "PredictiveAlert" DROP COLUMN "normalizacionLecturaEl", DROP COLUMN "normalizacionLecturaId",
--     DROP COLUMN "normalizacionValor", DROP COLUMN "resolucion", DROP COLUMN "resueltaEl", DROP COLUMN "resueltaPorId";
--   ALTER TABLE "PlanTask" DROP COLUMN "diariaConfirmadaEl", DROP COLUMN "diariaConfirmadaPorId";
--   ALTER TABLE "MeterReading" DROP COLUMN "tipoOriginal", DROP COLUMN "valorAnterior";
--   ALTER TABLE "Meter" DROP COLUMN "lecturaVigente", DROP COLUMN "valorInicial", DROP COLUMN "valorInicialEl";
-- y borrar el renglon de esta migracion en "_prisma_migrations".

-- AlterTable
ALTER TABLE "Meter" ADD COLUMN     "lecturaVigente" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "valorInicial" DOUBLE PRECISION,
ADD COLUMN     "valorInicialEl" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MeterReading" ADD COLUMN     "tipoOriginal" TEXT,
ADD COLUMN     "valorAnterior" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "PlanTask" ADD COLUMN     "diariaConfirmadaEl" TIMESTAMP(3),
ADD COLUMN     "diariaConfirmadaPorId" TEXT;

-- AlterTable
ALTER TABLE "PredictiveAlert" ADD COLUMN     "normalizacionLecturaEl" TIMESTAMP(3),
ADD COLUMN     "normalizacionLecturaId" TEXT,
ADD COLUMN     "normalizacionValor" DOUBLE PRECISION,
ADD COLUMN     "resolucion" TEXT,
ADD COLUMN     "resueltaEl" TIMESTAMP(3),
ADD COLUMN     "resueltaPorId" TEXT;

