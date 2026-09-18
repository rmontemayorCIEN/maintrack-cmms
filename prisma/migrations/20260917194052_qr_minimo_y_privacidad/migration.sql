-- El QR publico enseña lo minimo (Bloque 3).
-- Aditiva. Los puntos que ya existen quedan en «no mostrar»: es el cambio que se
-- busca —un codigo pegado en un pasillo deja de anunciar empresa, planta y
-- equipo— y se puede revertir punto por punto desde su configuracion.
-- Reversion:
--   ALTER TABLE "ReportPoint" DROP COLUMN "mostrarEmpresa", DROP COLUMN "mostrarPlanta", DROP COLUMN "mostrarEquipo";
--   ALTER TABLE "Organization" DROP COLUMN "avisoPrivacidadUrl";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "avisoPrivacidadUrl" TEXT;

-- AlterTable
ALTER TABLE "ReportPoint" ADD COLUMN     "mostrarEmpresa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mostrarEquipo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mostrarPlanta" BOOLEAN NOT NULL DEFAULT false;

