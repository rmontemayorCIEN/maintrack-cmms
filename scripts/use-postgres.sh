#!/usr/bin/env bash
# Prepara el proyecto para PostgreSQL (Cloud SQL) y genera la migracion inicial.
#
#   ./scripts/use-postgres.sh
#
# El esquema es portable: no usa enums ni arreglos nativos, asi que la unica
# diferencia entre SQLite (desarrollo) y PostgreSQL (produccion) es el proveedor.
set -euo pipefail

cd "$(dirname "$0")/.."

ESQUEMA="prisma/schema.prisma"

# Se busca la linea real del datasource (indentada), no cualquier mencion en un
# comentario: confundir ambas genera SQL del motor equivocado.
motor_actual() {
  grep -E '^[[:space:]]+provider[[:space:]]*=[[:space:]]*"(sqlite|postgresql)"' "$ESQUEMA" \
    | head -1 | sed -E 's/.*"(.*)".*/\1/'
}

if [ "$(motor_actual)" = "postgresql" ]; then
  echo "✓ El esquema ya apunta a PostgreSQL."
else
  sed -i.bak -E 's/^([[:space:]]+provider[[:space:]]*=[[:space:]]*)"sqlite"/\1"postgresql"/' "$ESQUEMA"
  rm -f "$ESQUEMA.bak"
  echo "✓ Datasource cambiado a postgresql."
fi

if [ "$(motor_actual)" != "postgresql" ]; then
  echo "ERROR: no se pudo cambiar el proveedor. Revise $ESQUEMA a mano." >&2
  exit 1
fi

# La migracion inicial se calcula contra el esquema, sin necesidad de una base
# de datos viva. Asi el despliegue puede ejecutar 'prisma migrate deploy'.
# La migracion inicial NO se regenera si ya existe: produccion la aplico y
# Prisma compara la huella del archivo. Reescribirla aborta el despliegue con
# "migration modified after applied". Para cambios de esquema posteriores se
# agrega una migracion nueva con scripts/nueva-migracion.sh
CARPETA="prisma/migrations/00000000000000_init"
if [ -f "$CARPETA/migration.sql" ]; then
  echo "✓ La migracion inicial ya existe (no se toca)."
  npx prisma generate >/dev/null 2>&1 && echo "✓ Cliente de Prisma regenerado."
  exit 0
fi

mkdir -p "$CARPETA"
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel "$ESQUEMA" \
  --script > "$CARPETA/migration.sql"
printf 'provider = "postgresql"\n' > prisma/migrations/migration_lock.toml

# Comprobacion: el SQL debe ser de PostgreSQL, no de SQLite.
if ! grep -q 'TIMESTAMP(3)' "$CARPETA/migration.sql"; then
  echo "ERROR: la migracion generada no parece de PostgreSQL." >&2
  exit 1
fi
echo "✓ Migracion inicial de PostgreSQL generada ($(wc -l < "$CARPETA/migration.sql") lineas)."

npx prisma generate >/dev/null 2>&1 && echo "✓ Cliente de Prisma regenerado."

echo ""
echo "Siguiente paso: exporte DATABASE_URL con la cadena de Cloud SQL y ejecute:"
echo "  npx prisma migrate deploy"
