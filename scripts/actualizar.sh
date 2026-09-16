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
source "$(dirname "$0")/proyecto.sh"

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

# La sincronizacion en la nube deja copias con " 2" y " 3" en el nombre dentro
# de .next, y esas copias rompen la verificacion de tipos con identificadores
# duplicados. Se limpian aqui para que no detengan un despliegue por algo que
# no tiene que ver con el codigo.
#
# El guardia `-d` no sobra: si `.next` no existe —recien clonado, o borrado a
# mano— find sale con 1, `set -o pipefail` se lo pasa a la asignacion, y
# `set -e` mata el despliegue en su primer paso. Paso de verdad, y el mensaje
# no decia nada util: "La actualizacion no termino (codigo 1)".
if [ -d .next ]; then
  BASURA=$(find .next -name "* [0-9].*" -delete -print 2>/dev/null | wc -l | tr -d " ")
  if [ "$BASURA" != "0" ]; then
    echo "     Se limpiaron $BASURA archivos duplicados por sincronizacion."
  fi
fi

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

npx tsx scripts/prueba-agenda.ts >/dev/null 2>&1 \
  && echo "     Festivos, dias habiles y carga correctos." \
  || { echo "     ERROR: la prueba de agenda fallo."; npx tsx scripts/prueba-agenda.ts; exit 1; }

npx tsx scripts/prueba-reprogramar.ts >/dev/null 2>&1 \
  && echo "     Guardas al reprogramar correctas." \
  || { echo "     ERROR: la prueba de reprogramacion fallo."; npx tsx scripts/prueba-reprogramar.ts; exit 1; }

npx tsx scripts/prueba-equivalencias.ts >/dev/null 2>&1 \
  && echo "     Equivalencias de refacciones correctas." \
  || { echo "     ERROR: la prueba de equivalencias fallo."; npx tsx scripts/prueba-equivalencias.ts; exit 1; }

npx tsx scripts/prueba-personal.ts >/dev/null 2>&1 \
  && echo "     Carga del equipo correcta." \
  || { echo "     ERROR: la prueba de carga del equipo fallo."; npx tsx scripts/prueba-personal.ts; exit 1; }

npx tsx scripts/prueba-asignaciones.ts >/dev/null 2>&1 \
  && echo "     Planes aplicados a varios equipos correctos." \
  || { echo "     ERROR: la prueba de asignaciones fallo."; npx tsx scripts/prueba-asignaciones.ts; exit 1; }

npx tsx scripts/prueba-ciclo-completo.ts >/dev/null 2>&1 \
  && echo "     Ciclo completo plan-orden-refaccion-cierre correcto." \
  || { echo "     ERROR: el ciclo completo fallo."; npx tsx scripts/prueba-ciclo-completo.ts; exit 1; }

# Los dos avisos. Su falla no la ve nadie: el sistema sigue funcionando y
# simplemente deja de avisar, que es indistinguible de "no habia nada que
# avisar". Por eso entran a la puerta del despliegue y no solo a la suite.
npx tsx scripts/prueba-avisos-push.ts >/dev/null 2>&1 \
  && echo "     Avisos al celular correctos." \
  || { echo "     ERROR: la prueba de avisos push fallo."; npx tsx scripts/prueba-avisos-push.ts; exit 1; }

npx tsx scripts/prueba-aviso-ya-se-puede.ts >/dev/null 2>&1 \
  && echo "     Aviso de trabajo que ya se puede hacer correcto." \
  || { echo "     ERROR: la prueba de 'ya se puede' fallo."; npx tsx scripts/prueba-aviso-ya-se-puede.ts; exit 1; }

# El croquis de la planta. Sus fallas tampoco truenan: se ven bien y no hacen
# nada —el acomodo que deja el lienzo vacio, la caja que al soltarla regresa
# al mismo lugar—. Se ven correctas hasta que alguien las usa.
npx tsx scripts/prueba-croquis.ts >/dev/null 2>&1 \
  && echo "     Croquis de la planta correcto." \
  || { echo "     ERROR: la prueba del croquis fallo."; npx tsx scripts/prueba-croquis.ts; exit 1; }

# Los conjuntos. Lo que se prueba es lo que el modelo esta disenado para
# impedir: que acomodar un lienzo desacomode al mismo equipo en otro, y que un
# equipo nuevo no aparezca en el residual —las dos fallan calladas—.
npx tsx scripts/prueba-conjuntos.ts >/dev/null 2>&1 \
  && echo "     Conjuntos de equipos correctos." \
  || { echo "     ERROR: la prueba de conjuntos fallo."; npx tsx scripts/prueba-conjuntos.ts; exit 1; }

# Un equipo dado de baja no debe generar preventivos. Fallaba callado: nada
# truena, el activo desaparece de la lista, y el sistema sigue emitiendo
# ordenes para el. El tecnico las recibe.
npx tsx scripts/prueba-equipo-de-baja.ts >/dev/null 2>&1 \
  && echo "     Los equipos de baja no generan preventivos." \
  || { echo "     ERROR: la prueba de equipos de baja fallo."; npx tsx scripts/prueba-equipo-de-baja.ts; exit 1; }

# Un reporte que llega sin equipo debe poder recibirlo al revisarse. Sin eso
# se convertia en una orden sin activo, que no entra al expediente de nadie.
npx tsx scripts/prueba-solicitud-sin-equipo.ts >/dev/null 2>&1 \
  && echo "     Las solicitudes sin equipo se pueden asignar al revisar." \
  || { echo "     ERROR: la prueba de solicitudes sin equipo fallo."; npx tsx scripts/prueba-solicitud-sin-equipo.ts; exit 1; }

# Cada actividad con su frecuencia. Si esto se rompe, el aceite se cambia de
# mas o el filtro de menos, y no avisa: la orden se ve normal.
npx tsx scripts/prueba-frecuencia-actividad.ts >/dev/null 2>&1 \
  && echo "     Cada actividad sale en su propia frecuencia." \
  || { echo "     ERROR: la prueba de frecuencia por actividad fallo."; npx tsx scripts/prueba-frecuencia-actividad.ts; exit 1; }

echo "  -> Calendario por actividad"
npx tsx scripts/prueba-calendario.ts >/dev/null 2>&1 \
  && echo "     ok" \
  || { echo "     ERROR: la aritmetica de fechas fallo."; npx tsx scripts/prueba-calendario.ts; exit 1; }

npx tsx scripts/prueba-calendario-actividad.ts >/dev/null 2>&1 \
  && echo "     ok" \
  || { echo "     ERROR: el calendario por actividad fallo."; npx tsx scripts/prueba-calendario-actividad.ts; exit 1; }

npx tsx scripts/prueba-orden-por-actividad.ts >/dev/null 2>&1 \
  && echo "     ok" \
  || { echo "     ERROR: armar ordenes actividad por actividad fallo."; npx tsx scripts/prueba-orden-por-actividad.ts; exit 1; }

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

# Que el servicio conserve TODO lo que la aplicacion necesita.
#
# Un secreto conectado a mano fuera de deploy.sh desaparece en el siguiente
# despliegue, porque --set-secrets reemplaza la lista completa. Nada falla: el
# despliegue sale verde y la funcion simplemente deja de existir. Ya paso con
# las llaves de los avisos y el sintoma aparecio dos despliegues despues, en
# otra pantalla. Aqui se compara contra lo que el secreto exista en el
# proyecto, no contra una lista escrita a mano que se quedaria vieja.
FALTANTES=""
VARIABLES=$(gcloud run services describe maintrack-cmms --region us-central1 \
  --format="value(spec.template.spec.containers[0].env[].name)" 2>/dev/null)
for par in "DATABASE_URL:cmms-database-url" "AUTH_SECRET:cmms-auth-secret" \
           "CRON_SECRET:cmms-cron-secret" "ANTHROPIC_API_KEY:cmms-anthropic-key" \
           "VAPID_PRIVATE_KEY:vapid-private-key" "VAPID_PUBLIC_KEY:vapid-public-key"; do
  VAR="${par%%:*}"; SECRETO="${par##*:}"
  if gcloud secrets describe "$SECRETO" >/dev/null 2>&1; then
    echo "$VARIABLES" | tr ';' '\n' | grep -qx "$VAR" || FALTANTES="$FALTANTES $VAR"
  fi
done

echo "     Acceso: HTTP $CODIGO"
if [ -z "$REDES" ]; then
  echo "     Cloud SQL: sin redes autorizadas (cerrada)"
else
  echo "     ATENCION: Cloud SQL sigue abierta a: $REDES"
fi
if [ -n "$FALTANTES" ]; then
  echo ""
  echo "     ATENCION: el servicio quedo SIN estas variables:$FALTANTES"
  echo "     El secreto existe en el proyecto pero no llego al servicio."
  echo "     Revise que esten declaradas en scripts/deploy.sh: conectarlas a"
  echo "     mano con 'gcloud run services update' no sirve, el siguiente"
  echo "     despliegue las borra."
else
  echo "     Secretos: todos los configurados llegaron al servicio."
fi

echo ""
[ "$CODIGO" = "200" ] && echo "✓ Actualizacion terminada. $URL" || echo "El sitio respondio $CODIGO; revise los registros."
