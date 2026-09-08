-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "margenPorHora" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "detieneLinea" BOOLEAN;

