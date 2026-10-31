-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpActivoEn" TIMESTAMP(3),
ADD COLUMN     "totpRespaldos" TEXT,
ADD COLUMN     "totpSecreto" TEXT,
ADD COLUMN     "totpUltimoPaso" INTEGER;

