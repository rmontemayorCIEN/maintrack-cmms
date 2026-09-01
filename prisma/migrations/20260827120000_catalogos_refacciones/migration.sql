-- CreateTable
CREATE TABLE "PartCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartUnit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartCategory_organizationId_idx" ON "PartCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PartCategory_organizationId_code_key" ON "PartCategory"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PartUnit_organizationId_idx" ON "PartUnit"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PartUnit_organizationId_code_key" ON "PartUnit"("organizationId", "code");

-- AddForeignKey
ALTER TABLE "PartCategory" ADD CONSTRAINT "PartCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartUnit" ADD CONSTRAINT "PartUnit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Sembrado. Todo lo que ya estaba capturado como texto libre se convierte en
-- entrada de catalogo, para que ninguna refaccion existente quede sin su
-- categoria o unidad. Es idempotente: se puede volver a correr sin duplicar.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Categorias que ya usan las refacciones
INSERT INTO "PartCategory" ("id", "organizationId", "code", "name", "createdAt")
SELECT gen_random_uuid()::text, p."organizationId", TRIM(p."category"), TRIM(p."category"), CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "organizationId", "category"
  FROM "Part"
  WHERE "category" IS NOT NULL AND TRIM("category") <> ''
) p
ON CONFLICT ("organizationId", "code") DO NOTHING;

-- 2. Unidades que ya usan las refacciones
INSERT INTO "PartUnit" ("id", "organizationId", "code", "name", "createdAt")
SELECT gen_random_uuid()::text, p."organizationId", TRIM(p."unit"), TRIM(p."unit"), CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "organizationId", "unit"
  FROM "Part"
  WHERE "unit" IS NOT NULL AND TRIM("unit") <> ''
) p
ON CONFLICT ("organizationId", "code") DO NOTHING;

-- 3. Unidades estandar, SOLO en organizaciones que aun no tienen refacciones.
--    Donde ya hay inventario, manda el vocabulario que el usuario ya venia
--    usando: sembrar la lista estandar encima crearia duplicados como
--    "Filtros" junto a "FILTROS".
INSERT INTO "PartUnit" ("id", "organizationId", "code", "name", "createdAt")
SELECT gen_random_uuid()::text, o."id", u."code", u."name", CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('pza',   'Pieza'),
  ('jgo',   'Juego'),
  ('par',   'Par'),
  ('m',     'Metro'),
  ('m2',    'Metro cuadrado'),
  ('kg',    'Kilogramo'),
  ('g',     'Gramo'),
  ('lt',    'Litro'),
  ('ml',    'Mililitro'),
  ('caja',  'Caja'),
  ('rollo', 'Rollo'),
  ('bote',  'Bote'),
  ('tramo', 'Tramo')
) AS u("code", "name")
WHERE NOT EXISTS (SELECT 1 FROM "Part" p WHERE p."organizationId" = o."id")
ON CONFLICT ("organizationId", "code") DO NOTHING;

-- 4. Familias estandar, con el mismo criterio que las unidades.
INSERT INTO "PartCategory" ("id", "organizationId", "code", "name", "createdAt")
SELECT gen_random_uuid()::text, o."id", c."code", c."name", CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('RODAMIENTOS',    'Rodamientos y baleros'),
  ('SELLOS',         'Sellos y empaques'),
  ('FILTROS',        'Filtros'),
  ('LUBRICANTES',    'Lubricantes y grasas'),
  ('BANDAS',         'Bandas y cadenas'),
  ('ELECTRICO',      'Material electrico'),
  ('NEUMATICO',      'Componentes neumaticos'),
  ('HIDRAULICO',     'Componentes hidraulicos'),
  ('INSTRUMENTACION','Instrumentacion y sensores'),
  ('TORNILLERIA',    'Tornilleria y sujecion'),
  ('CONSUMIBLES',    'Consumibles de taller'),
  ('OTRO',           'Otros')
) AS c("code", "name")
WHERE NOT EXISTS (SELECT 1 FROM "Part" p WHERE p."organizationId" = o."id")
ON CONFLICT ("organizationId", "code") DO NOTHING;
