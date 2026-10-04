#!/usr/bin/env bash
#
# Prueba de restauracion en un ambiente AISLADO. Bloque 8, seccion 6.
#
# La pregunta que contesta: si manana se pierde la base, ¿se puede recuperar
# de verdad? Tener respaldos configurados no es lo mismo que haber restaurado
# uno. Esto restaura de verdad, verifica lo restaurado y borra la copia.
#
# NO TOCA PRODUCCION. Clona la instancia a una NUEVA (`maintrack-db-rescate`),
# trabaja ahi, y al terminar la elimina. Produccion sigue sirviendo todo el
# tiempo; un clon de Cloud SQL se hace desde los respaldos, sin detener ni
# bloquear la instancia original.
#
#   ./scripts/prueba-restauracion.sh              # clona, verifica y borra
#   ./scripts/prueba-restauracion.sh --conservar  # no borra la copia al final
#
# Tarda entre diez y veinte minutos: crear una instancia de Cloud SQL no es
# rapido, y ese tiempo ES el dato que se busca (el objetivo de recuperacion).
set -euo pipefail
source "$(dirname "$0")/ip-publica.sh"
source "$(dirname "$0")/proyecto.sh"
cd "$(dirname "$0")/.."

ORIGEN="maintrack-db"
COPIA="maintrack-db-rescate"
CONSERVAR=0
[ "${1:-}" = "--conservar" ] && CONSERVAR=1

command -v gcloud >/dev/null || { echo "ERROR: gcloud no esta en el PATH."; exit 1; }

# La copia NUNCA puede ser la instancia buena. Un error de dedo aqui se lleva
# la base de los clientes por delante.
[ "$COPIA" = "$ORIGEN" ] && { echo "ERROR: la copia no puede llamarse igual que produccion."; exit 1; }
case "$COPIA" in *-rescate) ;; *) echo "ERROR: la copia debe terminar en -rescate."; exit 1;; esac

INICIO=$(date +%s)
echo "Prueba de restauracion en ambiente aislado"
echo "  origen: $ORIGEN (no se modifica)"
echo "  copia:  $COPIA"
echo ""

echo "1/5  Respaldos disponibles"
gcloud sql backups list --instance "$ORIGEN" --limit 5 \
  --format="table(id,windowStartTime,status,type)" || true
echo ""

# El momento al que se restaura: hace cinco minutos. Dentro de la ventana de
# recuperacion a un punto en el tiempo (7 dias) y suficientemente atras para
# que las transacciones esten asentadas.
MOMENTO=$(date -u -v-5M +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S.000Z)
echo "2/5  Clonando al momento $MOMENTO (tarda varios minutos)"
REUSADA=0
if gcloud sql instances describe "$COPIA" >/dev/null 2>&1; then
  REUSADA=1
  echo "     Ya existia una copia; se usa esa. Borrela si quiere una nueva:"
  echo "       gcloud sql instances delete $COPIA --project maintrack-cmms-4821"
else
  # `gcloud sql instances clone` se rinde de esperar antes de que Cloud SQL
  # termine (la instancia SI se crea; el cliente es el que se cansa). Por eso
  # el fallo no se toma como fallo: se espera a que la instancia quede
  # RUNNABLE, que es el hecho que importa.
  gcloud sql instances clone "$ORIGEN" "$COPIA" --point-in-time "$MOMENTO" || true
  echo "     Esperando a que la copia quede lista..."
fi

# La instancia aparece RUNNABLE antes de que Cloud SQL de por terminada la
# clonacion, y mientras haya una operacion viva TODO lo demas responde 409.
# Se espera a que no quede ninguna, que es lo que de verdad libera la copia.
echo "     Esperando a que Cloud SQL termine con la copia..."
LISTA=0
for _ in $(seq 1 90); do
  PENDIENTES=$(gcloud sql operations list --instance "$COPIA" --filter="status!=DONE" --format="value(name)" 2>/dev/null | wc -l | tr -d " ")
  ESTADO_COPIA=$(gcloud sql instances describe "$COPIA" --format="value(state)" 2>/dev/null || echo "")
  if [ "$PENDIENTES" = "0" ] && [ "$ESTADO_COPIA" = "RUNNABLE" ]; then LISTA=1; break; fi
  sleep 20
done
[ "$LISTA" = "1" ] || { echo "ERROR: la copia no quedo lista (estado: ${ESTADO_COPIA:-desconocido}, operaciones pendientes: ${PENDIENTES:-?})."; exit 1; }
CLONADA=$(date +%s)
echo "     Clonada en $(( (CLONADA - INICIO) / 60 )) min $(( (CLONADA - INICIO) % 60 )) s"
echo ""

limpiar() {
  local codigo=$?
  trap - EXIT INT TERM
  echo ""
  echo "→ Cerrando la puerta de la copia..."
  gcloud sql instances patch "$COPIA" --clear-authorized-networks --quiet >/dev/null 2>&1 || true
  if [ "$CONSERVAR" = "1" ]; then
    echo "  La copia $COPIA se conserva. Borrela cuando termine:"
    echo "    gcloud sql instances delete $COPIA --project maintrack-cmms-4821"
  else
    echo "→ Borrando la copia $COPIA..."
    gcloud sql instances delete "$COPIA" --quiet >/dev/null 2>&1 \
      && echo "  Borrada." \
      || echo "  ATENCION: no se pudo borrar. Hagalo a mano: gcloud sql instances delete $COPIA"
  fi
  ./scripts/revert-sqlite.sh >/dev/null 2>&1 || true
  exit $codigo
}
trap limpiar EXIT INT TERM

./scripts/use-postgres.sh >/dev/null

echo "3/5  Abriendo la copia para verificarla"
MI_IP=$(ip_publica) || { echo "ERROR: no se pudo determinar su IP publica."; exit 1; }
gcloud sql instances patch "$COPIA" --authorized-networks="$MI_IP/32" --quiet >/dev/null
IP_COPIA=$(gcloud sql instances describe "$COPIA" --format="value(ipAddresses[0].ipAddress)")
CLAVE=$(gcloud secrets versions access latest --secret=cmms-database-url \
  | sed -n 's|^postgresql://maintrack:\(.*\)@localhost/maintrack?host=.*$|\1|p')
[ -z "$CLAVE" ] && { echo "ERROR: no se pudo leer la cadena de conexion."; exit 1; }
echo "     Abierta para $MI_IP"
echo ""

# Produccion tambien se abre, en solo lectura, para poder comparar las dos.
gcloud sql instances patch "$ORIGEN" --authorized-networks="$MI_IP/32" --quiet >/dev/null
IP_ORIGEN=$(gcloud sql instances describe "$ORIGEN" --format="value(ipAddresses[0].ipAddress)")

echo "4/5  Verificando lo restaurado"
URL_BASE="sslmode=require&connection_limit=3&pool_timeout=30"
DATABASE_URL="postgresql://maintrack:$CLAVE@$IP_COPIA:5432/maintrack?$URL_BASE" \
URL_PRODUCCION="postgresql://maintrack:$CLAVE@$IP_ORIGEN:5432/maintrack?$URL_BASE" \
  npx tsx scripts/verificar-restauracion.ts
ESTADO=$?
unset CLAVE

gcloud sql instances patch "$ORIGEN" --clear-authorized-networks --quiet >/dev/null 2>&1 || true

FIN=$(date +%s)
echo ""
if [ "$REUSADA" = "1" ]; then
  echo "5/5  Verificacion: $(( (FIN - INICIO) / 60 )) min $(( (FIN - INICIO) % 60 )) s"
  echo "     OJO: se reuso una copia ya creada, asi que este tiempo NO incluye la"
  echo "     clonacion, que es la parte larga. Para medir la recuperacion completa,"
  echo "     borre la copia y vuelva a correr."
else
  echo "5/5  Tiempo total de recuperacion: $(( (FIN - INICIO) / 60 )) min $(( (FIN - INICIO) % 60 )) s"
  echo "     (crear la instancia + verificar; repuntar el servicio a la copia seria un cambio de variable mas)"
fi
exit $ESTADO
