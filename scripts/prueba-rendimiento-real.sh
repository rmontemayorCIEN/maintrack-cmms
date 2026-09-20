#!/usr/bin/env bash
#
# La prueba de rendimiento en el motor DE VERDAD. Bloque 8, seccion 8.
#
# Por que no basta con medir en la maquina: desarrollo corre en SQLite, que
# vive DENTRO del proceso. Traer veinte mil renglones ahi cuesta microsegundos
# porque no hay red, no hay serializacion y no hay conexion que compartir. En
# produccion hay un PostgreSQL chico al otro lado de un cable, y ese mismo
# «traer veinte mil renglones» es lo que hace lenta una pantalla. Medir en
# SQLite y declarar que todo va bien es exactamente el error que este bloque
# vino a cazar.
#
# Que hace: crea una instancia NUEVA y vacia —no toca produccion ni la clona,
# asi que no hay un solo dato de ningun cliente de por medio—, le aplica las
# migraciones, le siembra el volumen de un piloto, mide, y la borra.
#
#   ./scripts/prueba-rendimiento-real.sh
#   ./scripts/prueba-rendimiento-real.sh --conservar
#
# Tarda entre veinte y treinta minutos, casi todo en crear la instancia.
set -euo pipefail
source "$(dirname "$0")/ip-publica.sh"
source "$(dirname "$0")/proyecto.sh"
cd "$(dirname "$0")/.."

BANCO="maintrack-db-banco"
CONSERVAR=0
[ "${1:-}" = "--conservar" ] && CONSERVAR=1

# La instancia de pruebas NUNCA puede ser la de produccion.
case "$BANCO" in *-banco) ;; *) echo "ERROR: la instancia de pruebas debe terminar en -banco."; exit 1;; esac
[ "$BANCO" = "maintrack-db" ] && { echo "ERROR: esa es la base de produccion."; exit 1; }

INICIO=$(date +%s)
CLAVE="banco-$(date +%s)-$RANDOM"

limpiar() {
  local codigo=$?
  trap - EXIT INT TERM
  echo ""
  if [ "$CONSERVAR" = "1" ]; then
    echo "→ La instancia $BANCO se conserva. Borrela con:"
    echo "    gcloud sql instances delete $BANCO --project maintrack-cmms-4821"
  else
    echo "→ Borrando la instancia de pruebas..."
    gcloud sql instances delete "$BANCO" --quiet >/dev/null 2>&1 \
      && echo "  Borrada." || echo "  ATENCION: borrela a mano: gcloud sql instances delete $BANCO"
  fi
  ./scripts/revert-sqlite.sh >/dev/null 2>&1 || true
  exit $codigo
}
trap limpiar EXIT INT TERM

echo "1/5  Creando una instancia vacia (lo mas tardado)"
if gcloud sql instances describe "$BANCO" >/dev/null 2>&1; then
  echo "     Ya existia; se usa esa."
else
  # El MISMO tamano que produccion: medir en una maquina mas grande daria un
  # numero bonito que no le sirve a nadie.
  # `--edition=ENTERPRISE` es obligatorio para los tamanos chicos: sin eso
  # Cloud SQL asume ENTERPRISE_PLUS y rechaza db-f1-micro, que es justamente
  # el tamano de produccion y por tanto el unico que sirve para medir.
  gcloud sql instances create "$BANCO" \
    --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro \
    --region=us-central1 --storage-size=10 --storage-type=SSD \
    --no-backup --quiet || true
  for _ in $(seq 1 60); do
    ESTADO=$(gcloud sql instances describe "$BANCO" --format="value(state)" 2>/dev/null || echo "")
    [ "$ESTADO" = "RUNNABLE" ] && break
    sleep 20
  done
  [ "${ESTADO:-}" = "RUNNABLE" ] || { echo "ERROR: la instancia no quedo lista."; exit 1; }
fi
echo "     Lista en $(( ($(date +%s) - INICIO) / 60 )) min"

echo ""
echo "2/5  Preparando el acceso"
gcloud sql users set-password postgres --instance "$BANCO" --password "$CLAVE" --quiet >/dev/null
gcloud sql databases create maintrack --instance "$BANCO" --quiet >/dev/null 2>&1 || true
MI_IP=$(ip_publica) || { echo "ERROR: no se pudo determinar su IP publica."; exit 1; }
gcloud sql instances patch "$BANCO" --authorized-networks="$MI_IP/32" --quiet >/dev/null
IP_BANCO=$(gcloud sql instances describe "$BANCO" --format="value(ipAddresses[0].ipAddress)")
URL="postgresql://postgres:$CLAVE@$IP_BANCO:5432/maintrack?sslmode=require&connection_limit=5&pool_timeout=30"
echo "     Abierta para $MI_IP"

./scripts/use-postgres.sh >/dev/null

echo ""
echo "3/5  Aplicando las migraciones"
DATABASE_URL="$URL" npx prisma migrate deploy 2>&1 | tail -3

echo ""
echo "4/5  Sembrando el volumen de un piloto (por la red, tarda)"
DATABASE_URL="$URL" npx tsx scripts/sembrar-volumen.ts

echo ""
echo "5/5  Midiendo"
DATABASE_URL="$URL" npx tsx scripts/prueba-rendimiento.ts
ESTADO_PRUEBA=$?

FIN=$(date +%s)
echo ""
echo "Tiempo total: $(( (FIN - INICIO) / 60 )) min"
exit $ESTADO_PRUEBA
