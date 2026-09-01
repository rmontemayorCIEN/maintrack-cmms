#!/usr/bin/env bash
# Prepara (o repara) el bucket de archivos en Google Cloud Storage.
#
#   ./scripts/configurar-almacen.sh
#
# Es idempotente: se puede correr las veces que haga falta. Ejecutelo tambien
# si cambia el dominio de la aplicacion — la regla CORS lista los origenes
# permitidos y hay que actualizarla, o el navegador bloqueara las subidas.
set -euo pipefail

PROYECTO=$(gcloud config get-value project 2>/dev/null)
[ -z "$PROYECTO" ] && { echo "ERROR: gcloud no tiene proyecto configurado."; exit 1; }

BUCKET="$PROYECTO-archivos"
REGION=us-central1
NUMERO=$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)')
CUENTA="$NUMERO-compute@developer.gserviceaccount.com"

echo "Proyecto : $PROYECTO"
echo "Bucket   : gs://$BUCKET"
echo ""

# 1. Bucket privado. La prevencion de acceso publico es deliberada: los
#    archivos solo se sirven con URL firmada y temporal.
if gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  echo "✓ El bucket ya existe."
else
  gcloud storage buckets create "gs://$BUCKET" \
    --location="$REGION" --uniform-bucket-level-access --public-access-prevention
  echo "✓ Bucket creado."
fi

# 2. La aplicacion lee y escribe objetos.
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$CUENTA" --role="roles/storage.objectAdmin" >/dev/null
echo "✓ Permiso de lectura y escritura."

# 3. Firma de URLs: la cuenta debe poder firmar en su propio nombre.
gcloud services enable iamcredentials.googleapis.com >/dev/null 2>&1
gcloud iam service-accounts add-iam-policy-binding "$CUENTA" \
  --member="serviceAccount:$CUENTA" \
  --role="roles/iam.serviceAccountTokenCreator" --quiet >/dev/null
echo "✓ Firma de URLs habilitada."

# 4. CORS. Sin esto la URL firmada es valida pero el NAVEGADOR bloquea la
#    subida: el archivo va de la pagina al bucket, y eso es una peticion
#    entre origenes distintos. Es facil de pasar por alto porque curl no
#    aplica CORS y las pruebas por linea de comandos salen bien.
URL_APP=$(gcloud run services describe maintrack-cmms --region "$REGION" \
  --format='value(status.url)' 2>/dev/null || true)
URL_ALT="https://maintrack-cmms-$NUMERO.$REGION.run.app"

TMP=$(mktemp)
cat > "$TMP" <<JSON
[
  {
    "origin": [$([ -n "$URL_APP" ] && printf '"%s", ' "$URL_APP")"$URL_ALT"],
    "method": ["PUT", "GET", "HEAD"],
    "responseHeader": ["Content-Type", "Content-Length", "x-goog-resumable"],
    "maxAgeSeconds": 3600
  }
]
JSON
gcloud storage buckets update "gs://$BUCKET" --cors-file="$TMP" >/dev/null
rm -f "$TMP"
echo "✓ CORS configurado para: ${URL_APP:-$URL_ALT}"

echo ""
echo "Compruebe que el navegador podra subir:"
echo "  curl -s -D - -o /dev/null -X OPTIONS \\"
echo "    https://storage.googleapis.com/$BUCKET/x \\"
echo "    -H 'Origin: ${URL_APP:-$URL_ALT}' \\"
echo "    -H 'Access-Control-Request-Method: PUT' | grep -i access-control"
