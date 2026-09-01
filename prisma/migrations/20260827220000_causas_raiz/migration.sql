-- La causa raiz pasa de texto libre a catalogo.
--
-- El orden importa: primero se crea la tabla, luego se conservan los valores
-- ya capturados como entradas de catalogo, se enlazan las ordenes existentes,
-- y solo al final se elimina la columna vieja. Hacerlo al reves perderia el
-- historial de fallas, que es justamente lo que da valor al analisis.

-- 1. Catalogo
CREATE TABLE "RootCause" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RootCause_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RootCause_organizationId_idx" ON "RootCause"("organizationId");
CREATE UNIQUE INDEX "RootCause_organizationId_code_key" ON "RootCause"("organizationId", "code");

ALTER TABLE "RootCause" ADD CONSTRAINT "RootCause_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Nueva referencia en la orden de trabajo
ALTER TABLE "WorkOrder" ADD COLUMN "rootCauseId" TEXT;

-- 3. Lo ya capturado se vuelve catalogo. El texto sirve de codigo y de
--    descripcion; despues se puede renombrar desde la pantalla de Catalogos.
INSERT INTO "RootCause" ("id", "organizationId", "code", "description", "createdAt")
SELECT gen_random_uuid()::text, w."organizationId",
       LEFT(TRIM(w."rootCause"), 60), TRIM(w."rootCause"), CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "organizationId", "rootCause"
  FROM "WorkOrder"
  WHERE "rootCause" IS NOT NULL AND TRIM("rootCause") <> ''
) w
ON CONFLICT ("organizationId", "code") DO NOTHING;

-- 4. Cada orden apunta a su entrada de catalogo
UPDATE "WorkOrder" w
SET "rootCauseId" = rc."id"
FROM "RootCause" rc
WHERE rc."organizationId" = w."organizationId"
  AND rc."code" = LEFT(TRIM(w."rootCause"), 60)
  AND w."rootCause" IS NOT NULL
  AND TRIM(w."rootCause") <> '';

-- 5. Catalogo base para las organizaciones que aun no tienen ninguna causa
INSERT INTO "RootCause" ("id", "organizationId", "code", "description", "category", "createdAt")
SELECT gen_random_uuid()::text, o."id", c."code", c."description", c."categoria", CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('LUB-NO-EJECUTADA', 'Ruta de lubricacion no ejecutada',        'MANTENIMIENTO'),
  ('LUB-INCORRECTO',   'Lubricante incorrecto o contaminado',     'MANTENIMIENTO'),
  ('DESALINEACION',    'Desalineacion de acoplamiento',           'INSTALACION'),
  ('DESBALANCEO',      'Desbalanceo de rotor',                    'INSTALACION'),
  ('MONTAJE',          'Montaje o apriete incorrecto',            'INSTALACION'),
  ('SOBRECARGA',       'Operacion fuera de condiciones de diseño','OPERACION'),
  ('OPERACION-ERROR',  'Error de operacion',                      'OPERACION'),
  ('FIN-VIDA-UTIL',    'Fin de vida util del componente',         'DESGASTE'),
  ('FATIGA',           'Fatiga de material',                      'DESGASTE'),
  ('CORROSION',        'Corrosion o ambiente agresivo',           'AMBIENTE'),
  ('SUCIEDAD',         'Contaminacion por polvo o suciedad',      'AMBIENTE'),
  ('ENERGIA',          'Variacion o falla de suministro electrico','EXTERNO'),
  ('REFACCION',        'Refaccion de calidad deficiente',         'EXTERNO'),
  ('DISENO',           'Deficiencia de diseño o seleccion',       'DISENO'),
  ('SIN-DETERMINAR',   'Sin determinar',                          'OTRO')
) AS c("code", "description", "categoria")
WHERE NOT EXISTS (SELECT 1 FROM "RootCause" r WHERE r."organizationId" = o."id")
ON CONFLICT ("organizationId", "code") DO NOTHING;

-- 6. Ya migrado, se retira la columna de texto libre
ALTER TABLE "WorkOrder" DROP COLUMN "rootCause";

ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_rootCauseId_fkey"
  FOREIGN KEY ("rootCauseId") REFERENCES "RootCause"("id") ON DELETE SET NULL ON UPDATE CASCADE;
