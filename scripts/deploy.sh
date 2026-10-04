#!/usr/bin/env bash
# Publica los cambios locales en Cloud Run.
#
#   npm run deploy
#
# Sube el contenido de esta carpeta, Cloud Build arma la imagen a partir del
# Dockerfile y Cloud Run la pone en linea. No hace falta Docker ni GitHub.
#
# ── Vistas previas (las usa GitHub Actions; a mano casi nunca hacen falta)
#
#   ETIQUETA=pr-42 SIN_TRAFICO=1 SECRETO_DB=cmms-database-url-pruebas npm run deploy
#
# Publica una revision con su propia liga y SIN llevarse el trafico, contra la
# base de PRUEBAS. Sirve para que Calidad pruebe un cambio antes de liberarlo.
#
# Estas opciones viven AQUI y no escritas en el workflow a proposito: este
# archivo es el unico lugar que conoce la lista completa de secretos, el bucket
# y la conexion a Cloud SQL. Un `gcloud run deploy` copiado a otro lado se
# lleva todo eso por delante —ya paso, y los avisos al celular se apagaron sin
# que nada fallara—.
set -euo pipefail
source "$(dirname "$0")/proyecto.sh"

cd "$(dirname "$0")/.."

SERVICIO=maintrack-cmms
REGION=us-central1
# La instancia tambien se puede cambiar: una vista previa NO se conecta a la
# base de los clientes. Sin esto, separar la base por secreto no serviria de
# nada porque el contenedor seguiria montando la instancia de produccion.
INSTANCIA_SQL="${INSTANCIA_SQL:-maintrack-db}"
BUCKET_ARCHIVOS="$(gcloud config get-value project 2>/dev/null)-archivos"

command -v gcloud >/dev/null || { echo "ERROR: gcloud no esta en el PATH."; exit 1; }

# Una migracion generada mientras el esquema estaba en SQLite trae tipos que
# PostgreSQL no conoce (DATETIME en vez de TIMESTAMP). Si eso llega a produccion
# la migracion falla, el codigo se publica igual, y el servicio queda
# consultando tablas que no existen. Ya paso una vez: por eso se revisa aqui,
# que es el ultimo punto antes de publicar.
MALAS=$(grep -rlE '\bDATETIME\b|PRAGMA ' prisma/migrations --include=migration.sql 2>/dev/null || true)
if [ -n "$MALAS" ]; then
  echo "ERROR: hay migraciones con sintaxis de SQLite:"
  echo "$MALAS" | sed 's/^/  /'
  echo ""
  echo "       Se generaron con el esquema en SQLite. Corrijalas asi:"
  echo "         ./scripts/use-postgres.sh"
  echo "         npx prisma migrate diff --from-schema-datamodel <base> \\"
  echo "           --to-schema-datamodel prisma/schema.prisma --script > <archivo>"
  exit 1
fi

# Se le pide el nombre a Google en vez de construirlo: en zsh, "$VAR:us-central1"
# activa el modificador :u y deforma el valor.
#
# El error se guarda: distinguir "la instancia no existe" de "no llegue a
# Google" es la diferencia entre revisar la configuracion media hora y ver que
# se cayo el internet. Ya paso: el mensaje mandaba a revisar el proyecto cuando
# el proyecto estaba bien y lo que fallaba era el DNS.
SALIDA_SQL=$(gcloud sql instances describe "$INSTANCIA_SQL" \
  --format="value(connectionName)" 2>&1) || SALIDA_SQL="$SALIDA_SQL"
INSTANCIA=$(printf '%s' "$SALIDA_SQL" | grep -E '^[a-z0-9-]+:[a-z0-9-]+:[a-z0-9-]+$' | head -1)

if [ -z "$INSTANCIA" ]; then
  echo ""
  if printf '%s' "$SALIDA_SQL" | grep -qiE "failed to resolve|nodename nor servname|connectionerror|max retries|network is unreachable|temporary failure in name resolution"; then
    echo "ERROR: no se pudo llegar a Google. Parece que no hay conexion."
    echo ""
    echo "       No es problema del codigo ni del proyecto. Compruebelo con:"
    echo "         ping -c1 google.com"
    echo ""
    echo "       Su commit esta a salvo. Cuando vuelva la red, repita el mismo"
    echo "       comando: no hace falta deshacer nada."
  elif printf '%s' "$SALIDA_SQL" | grep -qiE "credential|reauth|login|unauthorized|permission"; then
    echo "ERROR: gcloud no tiene sesion valida."
    echo "       Vuelva a entrar con:  gcloud auth login"
  else
    echo "ERROR: no se encontro la instancia $INSTANCIA_SQL."
    echo "       Revise que gcloud apunte al proyecto correcto:"
    echo "         gcloud config get-value project"
    echo ""
    echo "       Lo que contesto Google:"
    printf '%s\n' "$SALIDA_SQL" | head -5 | sed 's/^/         /'
  fi
  exit 1
fi

# --update-env-vars y no --set-env-vars: el segundo reemplaza TODA la lista, y
# un despliegue hecho sin ANTHROPIC_WORKSPACE_ID en el ambiente borraria el
# valor ya configurado en el servicio. Aditivo, lo que se configura una vez se
# queda.

# ¿Existe ese secreto? TRES respuestas, no dos.
#
# `gcloud secrets describe` falla igual cuando el secreto NO EXISTE y cuando no
# se tiene permiso de preguntar. Tratar los dos casos igual casi apaga la IA y
# los avisos al celular en produccion: la cuenta de GitHub tenia permiso de
# LEER el valor pero no de preguntar si existia, asi que este script concluyo
# «no esta» y habria publicado sin ellos, sin que nada fallara.
#
# Es el mismo desastre que traia el deploy.yml viejo, por otra puerta. Ante la
# duda ya no se publica: se detiene y se dice por que.
hay_secreto() {
  local salida
  if salida=$(gcloud secrets describe "$1" 2>&1); then return 0; fi
  if printf '%s' "$salida" | grep -qiE "NOT_FOUND|was not found|does not exist"; then
    return 1
  fi
  echo ""
  echo "ERROR: no se pudo determinar si el secreto «$1» existe."
  echo ""
  echo "       Que no se pueda preguntar NO significa que no exista. Publicar"
  echo "       asi dejaria el servicio sin ese secreto y sin avisar a nadie."
  echo ""
  echo "       Lo que contesto Google:"
  printf '%s\n' "$salida" | head -3 | sed 's/^/         /'
  echo ""
  echo "       Si es la cuenta de GitHub, le falta roles/secretmanager.viewer."
  exit 1
}

# La llave de Anthropic es opcional: mientras no exista el secreto, la app se
# publica igual y las funciones de IA quedan visibles pero inactivas.
# Por omision la base de produccion. Una vista previa pasa la suya, que es lo
# unico que la separa de los datos de los clientes.
SECRETO_DB="${SECRETO_DB:-cmms-database-url}"
SECRETOS="DATABASE_URL=$SECRETO_DB:latest,AUTH_SECRET=cmms-auth-secret:latest,CRON_SECRET=cmms-cron-secret:latest"
if hay_secreto cmms-anthropic-key; then
  SECRETOS="$SECRETOS,ANTHROPIC_API_KEY=cmms-anthropic-key:latest"
  IA="habilitada"
else
  IA="no configurada (falta el secreto cmms-anthropic-key)"
fi

# Avisos al celular. Opcionales igual que la IA: sin llaves la funcion queda
# apagada y la pantalla lo dice, pero la aplicacion se publica igual.
#
# TIENEN QUE ESTAR AQUI. `--set-secrets` de abajo reemplaza la lista COMPLETA,
# asi que un secreto conectado a mano con `gcloud run services update` se borra
# en el siguiente despliegue. Paso: los avisos dejaron de funcionar sin que
# nada fallara, y el sintoma aparecio en otra pantalla dos despliegues despues.
# Todo lo que la aplicacion necesite se declara en este archivo, sin excepcion.
if hay_secreto vapid-private-key; then
  SECRETOS="$SECRETOS,VAPID_PRIVATE_KEY=vapid-private-key:latest,VAPID_PUBLIC_KEY=vapid-public-key:latest"
  AVISOS="habilitados"
else
  AVISOS="no configurados (faltan las llaves VAPID)"
fi

# Una vista previa nace con su propia liga y sin trafico. Sin --no-traffic la
# revision de una propuesta sin revisar se llevaria a los clientes de golpe.
EXTRA=""
if [ -n "${ETIQUETA:-}" ]; then
  EXTRA="--tag=$ETIQUETA"
  [ "${SIN_TRAFICO:-0}" = "1" ] && EXTRA="$EXTRA --no-traffic"
fi

echo "Proyecto  : $(gcloud config get-value project 2>/dev/null)"
echo "Base      : $SECRETO_DB"
[ -n "$EXTRA" ] && echo "Vista prev: $EXTRA"
echo "Cloud SQL : $INSTANCIA"
echo "Archivos  : gs://$BUCKET_ARCHIVOS"
echo "IA        : $IA"
echo "Avisos    : $AVISOS"
echo "Publicando $SERVICIO en $REGION..."
echo ""

# Para poder revisar que se va a ejecutar sin publicar nada. Lo usa la prueba
# del propio script: una bandera mal armada no se descubre desplegando.
if [ "${MOSTRAR_COMANDO:-0}" = "1" ]; then
  echo "gcloud run deploy $SERVICIO --source . --region $REGION --add-cloudsql-instances=$INSTANCIA --set-secrets=$SECRETOS $EXTRA"
  exit 0
fi

if ! gcloud run deploy "$SERVICIO" \
  ${EXTRA:+$EXTRA} \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --add-cloudsql-instances="$INSTANCIA" \
  --update-env-vars="GCS_BUCKET=$BUCKET_ARCHIVOS${ANTHROPIC_WORKSPACE_ID:+,ANTHROPIC_WORKSPACE_ID=$ANTHROPIC_WORKSPACE_ID}" \
  --set-secrets="$SECRETOS"; then

  echo ""
  echo "═════════ EL DESPLIEGUE FALLO ═════════"
  echo "La causa real esta en el registro de la construccion:"
  ID=$(gcloud builds list --limit=1 --format="value(id)" 2>/dev/null || true)
  [ -n "$ID" ] && gcloud builds log "$ID" 2>/dev/null | tail -40
  exit 1
fi

# ── Que el trafico siga al codigo nuevo
#
# No es redundante, y costo caro descubrirlo. Una vista previa se publica con
# --no-traffic, y eso cambia el reparto del servicio de «siempre la ultima» a
# «esta revision y solo esta». Desde ahi, cada despliegue de produccion creaba
# su revision y el trafico se quedaba clavado en la anterior: la liberacion
# decia que todo bien y los clientes seguian con el codigo viejo. Y el humo lo
# confirmaba, porque pega contra la direccion del servicio.
#
# Se nombra la revision EXACTA en vez de usar --to-latest. «La ultima creada»
# puede ser una vista previa —que apunta a la base de PRUEBAS— si una propuesta
# se publico mientras tanto. Mandar a los clientes ahi seria peor que no
# publicar.
if [ -z "${ETIQUETA:-}" ]; then
  NUEVA=$(gcloud run services describe "$SERVICIO" --region "$REGION" \
          --format='value(status.latestCreatedRevisionName)')
  gcloud run services update-traffic "$SERVICIO" --region "$REGION" \
    --to-revisions="$NUEVA=100" --quiet >/dev/null
  echo "Atendiendo: $NUEVA"
fi

echo ""
echo "✓ Publicado en: $(gcloud run services describe "$SERVICIO" --region "$REGION" --format='value(status.url)')"
