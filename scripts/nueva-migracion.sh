#!/usr/bin/env bash
# Genera una migracion nueva a partir de los cambios del esquema.
#
#   ./scripts/nueva-migracion.sh nombre_descriptivo
#
# Compara el estado que producen las migraciones ya existentes contra el
# esquema actual, y escribe solo la diferencia. Nunca toca las anteriores.
set -euo pipefail
cd "$(dirname "$0")/.."

NOMBRE="${1:-}"
[ -z "$NOMBRE" ] && { echo "Uso: ./scripts/nueva-migracion.sh nombre_descriptivo"; exit 1; }

grep -q '^  provider = "postgresql"' prisma/schema.prisma \
  || { echo "ERROR: el esquema no apunta a postgresql. Ejecute ./scripts/use-postgres.sh"; exit 1; }

SELLO=$(date +%Y%m%d%H%M%S)
CARPETA="prisma/migrations/${SELLO}_${NOMBRE}"

# El SQL se genera en un temporal y la carpeta se crea al final, ya con
# contenido. Si se crea antes y el comando falla, queda una carpeta vacia que
# Prisma cuenta como migracion y rechaza el despliegue completo con un P3015
# —un error que aparece hasta el siguiente despliegue, lejos de su causa.
TEMPORAL=$(mktemp)
trap 'rm -f "$TEMPORAL"' EXIT

npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "${SHADOW_DATABASE_URL:-}" \
  --script > "$TEMPORAL" 2>/dev/null \
|| npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma.anterior \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$TEMPORAL"

# Prisma no deja el archivo vacio cuando no hay diferencias: escribe un
# comentario que dice que la migracion esta vacia. Sin esta guarda se creaba
# una carpeta con una migracion que no hace nada.
if [ ! -s "$TEMPORAL" ] || grep -qi "empty migration" "$TEMPORAL"; then
  echo "No hay cambios de esquema pendientes."
  exit 0
fi

mkdir -p "$CARPETA"
cp "$TEMPORAL" "$CARPETA/migration.sql"

# La copia de referencia se actualiza al estado recien migrado. Sin esto, la
# siguiente migracion se diferenciaria contra un esquema viejo y repetiria
# cambios ya aplicados.
cp prisma/schema.prisma prisma/schema.prisma.anterior

echo "✓ Migracion escrita en $CARPETA"
echo "  Revisela antes de desplegar: cat $CARPETA/migration.sql"
