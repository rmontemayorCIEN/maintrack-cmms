-- AlterTable
ALTER TABLE "WorkRequest" ADD COLUMN     "iaDuplicadoDe" TEXT,
ADD COLUMN     "iaEl" TIMESTAMP(3),
ADD COLUMN     "iaPrioridad" TEXT,
ADD COLUMN     "iaResumen" TEXT,
ADD COLUMN     "iaTipo" TEXT,
ADD COLUMN     "iaTitulo" TEXT,
ADD COLUMN     "riesgo" TEXT NOT NULL DEFAULT 'NINGUNO',
ADD COLUMN     "riesgoMotivo" TEXT;

