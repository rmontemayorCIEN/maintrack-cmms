-- La preferencia de vista deja de ser exclusiva de activos y pasa a ser un
-- objeto por tabla. El orden importa: primero nace la columna nueva, luego se
-- copia lo que ya habia, y hasta el final se suelta la vieja. La migracion
-- generada por Prisma hacia el DROP directo y se llevaba las vistas que los
-- usuarios ya tenian guardadas.

-- 1. La columna nueva
ALTER TABLE "User" ADD COLUMN "vistasTabla" TEXT NOT NULL DEFAULT '{}';

-- 2. Lo guardado se conserva, bajo la llave de su tabla
UPDATE "User"
   SET "vistasTabla" = '{"activos":' || "vistaActivos" || '}'
 WHERE "vistaActivos" IS NOT NULL
   AND btrim("vistaActivos") NOT IN ('', '{}');

-- 3. Ya sin datos que perder
ALTER TABLE "User" DROP COLUMN "vistaActivos";
