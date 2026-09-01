#!/usr/bin/env bash
# Publica los cambios locales en Cloud Run.
#
#   npm run deploy
#
# Sube el contenido de esta carpeta, Cloud Build arma la imagen a partir del
# Dockerfile y Cloud Run la pone en linea. No hace falta Docker ni GitHub.
set -euo pipefail

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
INSTANCIA=$(gcloud sql instances describe "$INSTANCIA_SQL" \
  --format="value(connectionName)" 2>/dev/null || true)

if [ -z "$INSTANCIA" ]; then
  echo "ERROR: no se encontro la instancia $INSTANCIA_SQL."
  echo "       Revise que gcloud apunte al proyecto correcto:"
  echo "         gcloud config get-value project"
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

echo "Proyecto  : $(gcloud config get-value project 2>/dev/null)"
echo "Cloud SQL : $INSTANCIA"
echo "Archivos  : gs://$BUCKET_ARCHIVOS"
echo "IA        : $IA"
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
