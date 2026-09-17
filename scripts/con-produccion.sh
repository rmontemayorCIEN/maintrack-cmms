#!/usr/bin/env bash
#
# Ejecuta un script contra la base de PRODUCCION.
#
# Abre la puerta de Cloud SQL, ejecuta la consulta y la cierra. La trampa
# garantiza que la puerta quede cerrada aunque el proceso falle, se corte la
# red o se cancele a la mitad: el mismo criterio que en actualizar.sh.
#
#   ./scripts/con-produccion.sh scripts/rescatar-levantamiento.ts "Casa Montemayor"
#
set -euo pipefail
source "$(dirname "$0")/proyecto.sh"
cd "$(dirname "$0")/.."

INSTANCIA_SQL="maintrack-db"
PUERTA_ABIERTA=0
SCRIPT="${1:?Falta el script a ejecutar}"; shift

command -v gcloud >/dev/null || { echo "ERROR: gcloud no esta en el PATH."; exit 1; }

limpiar() {
  local codigo=$?
  trap - EXIT INT TERM
  if [ "$PUERTA_ABIERTA" = "1" ]; then
    echo ""
    echo "→ Cerrando la puerta de Cloud SQL..."
    if gcloud sql instances patch "$INSTANCIA_SQL" --clear-authorized-networks --quiet >/dev/null 2>&1; then
      echo "  Cerrada."
    else
      echo "  ATENCION: no se pudo cerrar automaticamente. Cierrela a mano:"
      echo "    gcloud sql instances patch $INSTANCIA_SQL --clear-authorized-networks --quiet"
    fi
  fi
  ./scripts/revert-sqlite.sh >/dev/null 2>&1 || true
  exit $codigo
}
trap limpiar EXIT INT TERM

./scripts/use-postgres.sh >/dev/null

MI_IP=$(curl -s --max-time 20 https://api.ipify.org)
[ -z "$MI_IP" ] && { echo "ERROR: no se pudo determinar su IP publica."; exit 1; }

gcloud sql instances patch "$INSTANCIA_SQL" --authorized-networks="$MI_IP/32" --quiet >/dev/null
PUERTA_ABIERTA=1
echo "Puerta abierta para $MI_IP"

IP_DB=$(gcloud sql instances describe "$INSTANCIA_SQL" --format="value(ipAddresses[0].ipAddress)")
CLAVE=$(gcloud secrets versions access latest --secret=cmms-database-url \
  | sed -n 's|^postgresql://maintrack:\(.*\)@localhost/maintrack?host=.*$|\1|p')
[ -z "$CLAVE" ] && { echo "ERROR: no se pudo leer la cadena de conexion del Secret Manager."; exit 1; }

# La llave de IA vive en Secret Manager; se trae solo si el script la necesita
# y nunca pasa por el historial ni se imprime.
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  ANTHROPIC_API_KEY="$(gcloud secrets versions access latest --secret=cmms-anthropic-key 2>/dev/null || true)"
  export ANTHROPIC_API_KEY
fi

# Pocas conexiones a proposito. La instancia es chica (db-f1-micro, ~25
# conexiones) y la aplicacion en Cloud Run ya usa las suyas: un script con el
# grupo de conexiones que Prisma abre por omision (uno por CPU x2 + 1) se las
# come y los CLIENTES empiezan a ver errores de base. Paso al correr la lista
# de saneamiento con el servicio caliente. Tres alcanzan de sobra para un
# script de consola, que es secuencial.
DATABASE_URL="postgresql://maintrack:$CLAVE@$IP_DB:5432/maintrack?sslmode=require&connection_limit=3&pool_timeout=30" \
  npx tsx "$SCRIPT" "$@"
unset CLAVE
