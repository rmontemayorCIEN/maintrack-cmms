#!/usr/bin/env bash
# Publica los cambios locales en Cloud Run.
#
#   npm run deploy
#
# Sube el contenido de esta carpeta, Cloud Build arma la imagen a partir del
# Dockerfile y Cloud Run la pone en linea. No hace falta Docker ni GitHub.
set -euo pipefail
source "$(dirname "$0")/proyecto.sh"

cd "$(dirname "$0")/.."

SERVICIO=maintrack-cmms
REGION=us-central1
INSTANCIA_SQL=maintrack-db
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

# La llave de Anthropic es opcional: mientras no exista el secreto, la app se
# publica igual y las funciones de IA quedan visibles pero inactivas.
SECRETOS="DATABASE_URL=cmms-database-url:latest,AUTH_SECRET=cmms-auth-secret:latest,CRON_SECRET=cmms-cron-secret:latest"
if gcloud secrets describe cmms-anthropic-key >/dev/null 2>&1; then
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
if gcloud secrets describe vapid-private-key >/dev/null 2>&1; then
  SECRETOS="$SECRETOS,VAPID_PRIVATE_KEY=vapid-private-key:latest,VAPID_PUBLIC_KEY=vapid-public-key:latest"
  AVISOS="habilitados"
else
  AVISOS="no configurados (faltan las llaves VAPID)"
fi

echo "Proyecto  : $(gcloud config get-value project 2>/dev/null)"
echo "Cloud SQL : $INSTANCIA"
echo "Archivos  : gs://$BUCKET_ARCHIVOS"
echo "IA        : $IA"
echo "Avisos    : $AVISOS"
echo "Publicando $SERVICIO en $REGION..."
echo ""

if ! gcloud run deploy "$SERVICIO" \
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

echo ""
echo "✓ Publicado en: $(gcloud run services describe "$SERVICIO" --region "$REGION" --format='value(status.url)')"
