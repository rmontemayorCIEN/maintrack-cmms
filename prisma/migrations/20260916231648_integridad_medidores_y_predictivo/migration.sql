-- Bloque 1 · Integridad de datos: validacion de medidores y logica predictiva.
--
-- Solo agrega columnas con valor por omision o nulas. No toca un solo valor
-- historico de lecturas ni de alertas.
--
-- Reversion (si hiciera falta), en este orden:
--   ALTER TABLE "PredictiveAlert" DROP COLUMN "condicion", DROP COLUMN "confianza",
--     DROP COLUMN "estadoActual", DROP COLUMN "evaluadaEl", DROP COLUMN "fechaCruceAdvertencia",
--     DROP COLUMN "fechaCruceCritico", DROP COLUMN "lecturasUsadas", DROP COLUMN "normalizadaEl",
--     DROP COLUMN "tendencia";
--   ALTER TABLE "MeterReading" DROP COLUMN "atipica", DROP COLUMN "correccionEl",
--     DROP COLUMN "correccionMotivo", DROP COLUMN "correccionPorId", DROP COLUMN "estado",
--     DROP COLUMN "fechaOriginal", DROP COLUMN "justificacion", DROP COLUMN "tipo",
--     DROP COLUMN "valorOriginal";
--   ALTER TABLE "Meter" DROP COLUMN "maxIncrementoDiario", DROP COLUMN "tipo";
-- y borrar el renglon de esta migracion en "_prisma_migrations".

-- AlterTable
ALTER TABLE "Meter" ADD COLUMN     "maxIncrementoDiario" DOUBLE PRECISION,
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'HOROMETRO';

-- AlterTable
ALTER TABLE "MeterReading" ADD COLUMN     "atipica" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "correccionEl" TIMESTAMP(3),
ADD COLUMN     "correccionMotivo" TEXT,
ADD COLUMN     "correccionPorId" TEXT,
ADD COLUMN     "estado" TEXT NOT NULL DEFAULT 'VALIDA',
ADD COLUMN     "fechaOriginal" TIMESTAMP(3),
ADD COLUMN     "justificacion" TEXT,
ADD COLUMN     "tipo" TEXT NOT NULL DEFAULT 'LECTURA',
ADD COLUMN     "valorOriginal" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "PredictiveAlert" ADD COLUMN     "condicion" TEXT,
ADD COLUMN     "confianza" TEXT,
ADD COLUMN     "estadoActual" TEXT,
ADD COLUMN     "evaluadaEl" TIMESTAMP(3),
ADD COLUMN     "fechaCruceAdvertencia" TIMESTAMP(3),
ADD COLUMN     "fechaCruceCritico" TIMESTAMP(3),
ADD COLUMN     "lecturasUsadas" INTEGER,
ADD COLUMN     "normalizadaEl" TIMESTAMP(3),
ADD COLUMN     "tendencia" TEXT;


-- El tipo de los medidores existentes sale de su unidad. Es configuracion, no
-- historia: decide que validacion aplica a las lecturas NUEVAS.
UPDATE "Meter" SET "tipo" = 'ODOMETRO' WHERE lower(trim("unit")) IN ('km', 'mi', 'kilometros', 'millas');
UPDATE "Meter" SET "tipo" = 'CICLOS' WHERE lower(trim("unit")) IN ('ciclos', 'pzas', 'piezas', 'arranques', 'golpes');
UPDATE "Meter" SET "tipo" = 'OTRO'
  WHERE lower(trim("unit")) NOT IN ('h', 'hr', 'hrs', 'horas', 'km', 'mi', 'kilometros', 'millas', 'ciclos', 'pzas', 'piezas', 'arranques', 'golpes');
