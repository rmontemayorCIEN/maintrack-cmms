-- Mapa de lineas: sitio y clasificacion de cada linea, para filtrar los
-- mapas de una planta grande. Aditiva: columnas nulas; ninguna linea cambia.
-- Reversion:
--   ALTER TABLE "Conjunto" DROP CONSTRAINT "Conjunto_siteId_fkey";
--   ALTER TABLE "Conjunto" DROP COLUMN "siteId", DROP COLUMN "clasificacion";

-- AlterTable
ALTER TABLE "Conjunto" ADD COLUMN     "clasificacion" TEXT,
ADD COLUMN     "siteId" TEXT;

-- AddForeignKey
ALTER TABLE "Conjunto" ADD CONSTRAINT "Conjunto_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

