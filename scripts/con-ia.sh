#!/usr/bin/env bash
#
# Ejecuta un script CON la llave de IA, contra la base LOCAL de desarrollo.
#
# POR QUE EXISTE, HABIENDO YA con-produccion.sh:
# Aquel abre un permiso de red en Cloud SQL y corre contra la base de los
# clientes. Para probar las funciones de IA no hace falta nada de eso: basta la
# llave. Este script trae solo la llave y trabaja contra dev.db, asi que las
# pruebas no pueden tocar datos de clientes ni por accidente.
#
# LA LLAVE NUNCA SE IMPRIME NI PASA POR EL HISTORIAL. Se lee de Secret Manager
# y se pone en el entorno del proceso hijo. Ya se quemaron dos llaves por
# escribirlas en la terminal; esta no.
#
# OJO: cada corrida hace llamadas reales y cuesta dinero. Al final se reporta
# cuanto costo, leyendolo de AiUsage.
#
#   ./scripts/con-ia.sh scripts/prueba-equipo-real.ts
#   ./scripts/con-ia.sh --todas
#
set -euo pipefail
source "$(dirname "$0")/proyecto.sh"
cd "$(dirname "$0")/.."

command -v gcloud >/dev/null || { echo "ERROR: gcloud no esta en el PATH."; exit 1; }

# La base tiene que ser la local. Sin esto, bastaria tener exportada la cadena
# de produccion para que una prueba escribiera en los datos de un cliente.
./scripts/revert-sqlite.sh >/dev/null 2>&1 || true
URL=$(grep -E "^DATABASE_URL=" .env | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"')
case "$URL" in
  file:*) ;;
  *) echo "ERROR: DATABASE_URL no apunta a la base local. No se corre nada."; exit 1 ;;
esac

echo "Trayendo la llave de Secret Manager..."
LLAVE=$(gcloud secrets versions access latest --secret=cmms-anthropic-key 2>/dev/null || true)
if [ -z "$LLAVE" ]; then
  echo ""
  echo "ERROR: no se pudo leer la llave."
  echo "  Revise que tenga sesion:            gcloud auth list"
  echo "  y acceso al secreto cmms-anthropic-key en el proyecto correcto."
  exit 1
fi
echo "  Lista. (No se imprime, ni queda en el historial.)"
echo ""

# El gasto de antes, para poder restar al final.
ANTES=$(ANTHROPIC_API_KEY="$LLAVE" npx tsx -e '
import { prisma } from "./lib/db";
prisma.aiUsage.aggregate({ _sum: { costUsd: true } })
  .then((r) => console.log(r._sum.costUsd ?? 0))
  .finally(() => prisma.$disconnect());
' 2>/dev/null | tail -1)

if [ "${1:-}" = "--todas" ]; then
  SCRIPTS=$(ls scripts/prueba-*-real.ts)
  echo "Corriendo las pruebas de IA contra la base local:"
else
  SCRIPTS="${1:?Falta el script a ejecutar}"
  shift || true
fi

FALLARON=0
for s in $SCRIPTS; do
  printf "  %-34s " "$(basename "$s" .ts)"
  if ANTHROPIC_API_KEY="$LLAVE" npx tsx "$s" > /tmp/ia-prueba.log 2>&1; then
    echo "OK"
  else
    echo "FALLA"
    tail -12 /tmp/ia-prueba.log | sed 's/^/      /'
    FALLARON=$((FALLARON + 1))
  fi
done

DESPUES=$(ANTHROPIC_API_KEY="$LLAVE" npx tsx -e '
import { prisma } from "./lib/db";
prisma.aiUsage.aggregate({ _sum: { costUsd: true } })
  .then((r) => console.log(r._sum.costUsd ?? 0))
  .finally(() => prisma.$disconnect());
' 2>/dev/null | tail -1)

echo ""
awk -v a="$ANTES" -v d="$DESPUES" 'BEGIN { printf "Costo de esta corrida: %.4f USD\n", d - a }'
echo ""
[ "$FALLARON" -eq 0 ] && echo "Todas pasaron." || echo "$FALLARON prueba(s) fallaron."
exit $FALLARON
