#!/usr/bin/env bash
#
# Publica una actualizacion completa: migra la base y despliega.
#
#   npm run actualizar
#   npm run actualizar -- --sin-migrar    (cuando el cambio no toca la base)
#
# La puerta de Cloud SQL se abre lo minimo indispensable y se cierra SOLA.
#
# Ese es el motivo de que este script exista. Antes la secuencia era una
# cadena de comandos y el cierre era el ultimo eslabon: si algo se cortaba a
# la mitad —la laptop se suspende, se pierde la red, alguien presiona Ctrl-C—
# la base quedaba expuesta a una IP de internet sin que nadie se enterara.
# Aqui el cierre esta en una trampa de salida: corre pase lo que pase.
set -euo pipefail

cd "$(dirname "$0")/.."

INSTANCIA_SQL=maintrack-db
PUERTA_ABIERTA=0
MIGRAR=1

for arg in "$@"; do
  [ "$arg" = "--sin-migrar" ] && MIGRAR=0
done

command -v gcloud >/dev/null || { echo "ERROR: gcloud no esta en el PATH."; exit 1; }

# ── La trampa: se ejecuta al terminar, falle o no ────────────────────────────
limpiar() {
  local codigo=$?
  # Una señal dispara la trampa y el exit la volveria a disparar: se desarma
  # de inmediato para que la limpieza corra una sola vez.
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
  # El proyecto vuelve a SQLite para poder seguir trabajando en local.
  ./scripts/revert-sqlite.sh >/dev/null 2>&1 || true
  [ "$codigo" -ne 0 ] && echo "" && echo "La actualizacion no termino (codigo $codigo)."
  exit $codigo
}
trap limpiar EXIT INT TERM

# ── 1. Revisiones antes de tocar nada ────────────────────────────────────────
echo "1/4  Revisando el codigo..."

# La sincronizacion de iCloud deja copias con " 2" y " 3" en el nombre dentro
# de .next, y esas copias rompen la verificacion de tipos con identificadores
# duplicados. Se limpian aqui para que no detengan un despliegue por algo que
# no tiene que ver con el codigo.
BASURA=$(find .next -name "* [0-9].*" -delete -print 2>/dev/null | wc -l | tr -d " ")
[ "$BASURA" != "0" ] && echo "     Se limpiaron $BASURA archivos duplicados por sincronizacion."

MALAS=$(grep -rlE '\bDATETIME\b|PRAGMA ' prisma/migrations --include=migration.sql 2>/dev/null || true)
if [ -n "$MALAS" ]; then
  echo "     ERROR: hay migraciones con sintaxis de SQLite:"
  echo "$MALAS" | sed 's/^/       /'
  echo "     Se generaron con el esquema en SQLite y PostgreSQL las va a rechazar."
  exit 1
fi

npx tsc --noEmit || { echo "     ERROR: el codigo no compila. No se publica nada."; exit 1; }
echo "     Sin errores de tipos y sin migraciones mal generadas."

# La ayuda se queda atras sola: una pantalla nueva sin ficha no rompe nada y por
# eso nadie lo nota, pero deja al usuario sin explicacion y a la ayuda con IA
# ciega sobre esa pantalla. No detiene el despliegue —documentacion faltante no
# debe bloquear un arreglo urgente— pero sale con nombre y apellido cada vez.
npx tsx scripts/revisar-ayuda.ts

# Los esquemas de IA se validan aparte porque su error no lo ve el compilador
# ni el despliegue: aparece cuando un usuario aprieta el boton en produccion.
npx tsx scripts/prueba-esquemas-ia.ts >/dev/null 2>&1 \
  && echo "     Esquemas de IA compatibles con la API." \
  || { echo "     ERROR: los esquemas de IA tienen restricciones que la API rechaza."; npx tsx scripts/prueba-esquemas-ia.ts; exit 1; }

npx tsx scripts/prueba-backlog.ts >/dev/null 2>&1 \
  && echo "     Liberacion de actividades y backlog correctos." \
  || { echo "     ERROR: la prueba de backlog fallo."; npx tsx scripts/prueba-backlog.ts; exit 1; }

# ── 2. Migracion, con la puerta abierta el menor tiempo posible ──────────────
if [ "$MIGRAR" = "1" ]; then
  echo ""
  echo "2/4  Migrando la base de datos..."
  ./scripts/use-postgres.sh >/dev/null

  MI_IP=$(curl -s --max-time 20 https://api.ipify.org)
  [ -z "$MI_IP" ] && { echo "     ERROR: no se pudo determinar su IP publica."; exit 1; }

  gcloud sql instances patch "$INSTANCIA_SQL" --authorized-networks="$MI_IP/32" --quiet >/dev/null
  PUERTA_ABIERTA=1
  echo "     Puerta abierta para $MI_IP"

  IP_DB=$(gcloud sql instances describe "$INSTANCIA_SQL" --format="value(ipAddresses[0].ipAddress)")
  CLAVE=$(gcloud secrets versions access latest --secret=cmms-database-url \
    | sed -n 's|^postgresql://maintrack:\(.*\)@localhost/maintrack?host=.*$|\1|p')
  [ -z "$CLAVE" ] && { echo "     ERROR: no se pudo leer la cadena de conexion del Secret Manager."; exit 1; }

  DATABASE_URL="postgresql://maintrack:$CLAVE@$IP_DB:5432/maintrack?sslmode=require" \
    npx prisma migrate deploy
  unset CLAVE

  # Se cierra en cuanto deja de hacer falta: el despliegue que sigue tarda
  # varios minutos y no necesita la base abierta.
  gcloud sql instances patch "$INSTANCIA_SQL" --clear-authorized-networks --quiet >/dev/null
  PUERTA_ABIERTA=0
  echo "     Migracion aplicada y puerta cerrada."
else
  echo ""
  echo "2/4  Migracion omitida (--sin-migrar)."
fi

# ── 3. Publicacion ───────────────────────────────────────────────────────────
echo ""
echo "3/4  Publicando en Cloud Run (tarda unos minutos)..."
npm run deploy

# ── 4. Verificacion ──────────────────────────────────────────────────────────
echo ""
# Respaldo despues de publicar. Corre aqui porque el despliegue es justo
# cuando acaba de quedar algo funcionando, y porque desde la terminal si hay
# permiso para leer la carpeta del proyecto (un agente en segundo plano no).
# No detiene nada si falla: el despliegue ya salio bien.
if [ -d "$HOME/Google Drive" ]; then
  bash "$(dirname "$0")/respaldar.sh" 2>&1 | sed 's/^/     /' || \
    echo "     Aviso: el respaldo a Drive no se pudo hacer. Corra: npm run respaldar"
fi

echo "4/4  Verificando..."
URL=$(gcloud run services describe maintrack-cmms --region us-central1 --format="value(status.url)")
CODIGO=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$URL/login")
REDES=$(gcloud sql instances describe "$INSTANCIA_SQL" \
  --format="value(settings.ipConfiguration.authorizedNetworks[].value)")

echo "     Acceso: HTTP $CODIGO"
if [ -z "$REDES" ]; then
  echo "     Cloud SQL: sin redes autorizadas (cerrada)"
else
  echo "     ATENCION: Cloud SQL sigue abierta a: $REDES"
fi

echo ""
[ "$CODIGO" = "200" ] && echo "✓ Actualizacion terminada. $URL" || echo "El sitio respondio $CODIGO; revise los registros."
