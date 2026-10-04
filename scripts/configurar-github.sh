#!/usr/bin/env bash
# Le da a GitHub permiso de publicar en Google Cloud, SIN llaves guardadas.
#
#   ./scripts/configurar-github.sh              # ensayo: dice que haria
#   ./scripts/configurar-github.sh --aplicar    # lo hace
#
# ── Por que sin llave JSON
#
# El camino comun es crear una cuenta de servicio, bajar su llave en un archivo
# JSON y pegarla como secreto del repositorio. Esa llave no caduca, sirve desde
# cualquier lugar del mundo y quien la vea una vez la tiene para siempre. El
# deploy.yml que habia en este repositorio hacia justo eso.
#
# La federacion de identidad (Workload Identity Federation) cambia el trato:
# Google confia en los identificadores que firma GitHub, y solo para ESTE
# repositorio. No hay archivo que robar, no hay llave que rotar, y si el
# repositorio deja de existir el permiso se queda sin sujeto.
#
# ── El detalle que lo hace seguro de verdad
#
# La condicion de abajo amarra el permiso al repositorio por nombre. Sin ella,
# CUALQUIER flujo de CUALQUIER repositorio de GitHub —del mundo, no de Rafael—
# podria pedir un identificador y entrar a este proyecto. Es el error clasico
# de esta configuracion.
set -euo pipefail
source "$(dirname "$0")/proyecto.sh"

REPO="rmontemayorCIEN/maintrack-cmms"
DEPOSITO="github"                        # el conjunto de identidades federadas
PROVEEDOR="github-oidc"
CUENTA="github-actions"
APLICAR=0
[ "${1:-}" = "--aplicar" ] && APLICAR=1

PROYECTO="$CLOUDSDK_CORE_PROJECT"
NUMERO=$(gcloud projects describe "$PROYECTO" --format="value(projectNumber)")
CORREO="$CUENTA@$PROYECTO.iam.gserviceaccount.com"

# Los permisos MINIMOS para publicar y migrar. Ni uno mas: esta cuenta la va a
# usar un agente, no una persona que pueda darse cuenta de lo que toca.
#
#   run.admin              publicar revisiones, mover trafico, borrar las de prueba
#   iam.serviceAccountUser actuar como la cuenta con la que corre el servicio
#   cloudbuild.builds.editor  armar la imagen desde el Dockerfile
#   artifactregistry.writer   guardar esa imagen
#   (rol a la medida)      listar y ver buckets, nada mas. Ver abajo por que
#                          NO se usa storage.admin ni storage.objectAdmin
#   secretmanager.secretAccessor  leer la cadena de conexion para migrar
#   secretmanager.viewer   PREGUNTAR si un secreto existe. No sobra: sin esto
#                          `deploy.sh` no distingue «no existe» de «no puedo
#                          preguntar» y publica sin la IA y sin los avisos, en
#                          silencio. Casi pasa en la primera liberacion.
#   cloudsql.client        conectarse por el proxy
#   cloudsql.viewer        preguntar el nombre de conexion de la instancia
#
# NO lleva: owner, editor, ni permiso de borrar bases o cambiar IAM.
PERMISOS=(
  roles/run.admin
  roles/iam.serviceAccountUser
  roles/cloudbuild.builds.editor
  roles/artifactregistry.writer
  roles/secretmanager.secretAccessor
  roles/secretmanager.viewer
  roles/cloudsql.client
  roles/cloudsql.viewer
)

hacer() {
  if [ "$APLICAR" = "1" ]; then "$@"; else echo "      (ensayo) $*"; fi
}

echo ""
echo "Proyecto   : $PROYECTO ($NUMERO)"
echo "Repositorio: $REPO"
echo "Cuenta     : $CORREO"
[ "$APLICAR" = "0" ] && echo "MODO ENSAYO: no se cambia nada. Agregue --aplicar para hacerlo."
echo ""

echo "1/5  Encendiendo los servicios que hacen falta..."
hacer gcloud services enable iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com --project "$PROYECTO" --quiet

echo "2/5  La cuenta de servicio..."
if gcloud iam service-accounts describe "$CORREO" --project "$PROYECTO" >/dev/null 2>&1; then
  echo "      ya existe, no se toca."
else
  hacer gcloud iam service-accounts create "$CUENTA" --project "$PROYECTO" \
    --display-name="GitHub Actions de MainTrack" \
    --description="Publica desde el repositorio $REPO. Sin llave JSON."
fi

# ── Por que un rol a la medida y no storage.admin
#
# `gcloud run deploy --source` necesita `storage.buckets.list` A NIVEL
# PROYECTO para encontrar su bucket de construccion. Lo comodo seria dar
# roles/storage.admin, y lo hace casi todo el mundo.
#
# Aqui no: en este proyecto vive tambien `maintrack-cmms-4821-archivos`, con
# las fotos y los adjuntos de Casa Montemayor, Acero Industrial y Minerales
# Metalicos. Dar storage.admin le entregaria eso completo a una cuenta que
# solo publica —y que van a manejar agentes—.
#
# Asi que: tres permisos de bucket a nivel proyecto, y mando completo SOLO
# sobre el bucket de construccion. Los archivos de los clientes quedan fuera
# de su alcance, comprobado.
ROL_ALMACEN="maintrack_despliegue_almacen"
echo "3/5  El rol a la medida para el almacenamiento..."
if gcloud iam roles describe "$ROL_ALMACEN" --project "$PROYECTO" >/dev/null 2>&1; then
  echo "      ya existe, no se toca."
else
  hacer gcloud iam roles create "$ROL_ALMACEN" --project="$PROYECTO" \
    --title="Despliegue: solo el bucket de construccion" \
    --description="Listar y ver buckets para que 'run deploy --source' encuentre el suyo. NO da acceso a los archivos de los clientes." \
    --permissions=storage.buckets.get,storage.buckets.list,storage.buckets.create \
    --stage=GA
fi
hacer gcloud projects add-iam-policy-binding "$PROYECTO" \
  --member="serviceAccount:$CORREO" \
  --role="projects/$PROYECTO/roles/$ROL_ALMACEN" --condition=None --quiet

echo "3/5  Sus permisos..."
for p in "${PERMISOS[@]}"; do
  echo "      $p"
  hacer gcloud projects add-iam-policy-binding "$PROYECTO" \
    --member="serviceAccount:$CORREO" --role="$p" --condition=None --quiet
done

# El bucket donde Cloud Build deja el codigo fuente. `storage.objectAdmin`
# cubre los objetos pero NO el bucket, y `gcloud run deploy --source` necesita
# `storage.buckets.get`: la primera liberacion murio justo ahi. Se concede
# sobre ESE bucket y no sobre el proyecto, que seria darle todo el
# almacenamiento a una cuenta que solo publica.
BUCKET="gs://run-sources-$PROYECTO-us-central1"
echo "3b/5 Permiso sobre el bucket de construccion (solo ese)..."
if gcloud storage buckets describe "$BUCKET" --project "$PROYECTO" >/dev/null 2>&1; then
  hacer gcloud storage buckets add-iam-policy-binding "$BUCKET" \
    --member="serviceAccount:$CORREO" --role=roles/storage.admin --quiet
else
  echo "      todavia no existe; lo crea el primer despliegue. Vuelva a correr esto despues."
fi

echo "4/5  El deposito de identidades federadas..."
if gcloud iam workload-identity-pools describe "$DEPOSITO" \
   --location=global --project "$PROYECTO" >/dev/null 2>&1; then
  echo "      ya existe, no se toca."
else
  hacer gcloud iam workload-identity-pools create "$DEPOSITO" \
    --location=global --project "$PROYECTO" \
    --display-name="GitHub"
fi

if gcloud iam workload-identity-pools providers describe "$PROVEEDOR" \
   --workload-identity-pool="$DEPOSITO" --location=global --project "$PROYECTO" >/dev/null 2>&1; then
  echo "      el proveedor ya existe, no se toca."
else
  # attribute-condition es la reja: solo identificadores de ESTE repositorio.
  hacer gcloud iam workload-identity-pools providers create-oidc "$PROVEEDOR" \
    --workload-identity-pool="$DEPOSITO" --location=global --project "$PROYECTO" \
    --display-name="GitHub Actions" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository == '$REPO'"
fi

echo "5/5  Dejando que SOLO ese repositorio use la cuenta..."
PRINCIPAL="principalSet://iam.googleapis.com/projects/$NUMERO/locations/global/workloadIdentityPools/$DEPOSITO/attribute.repository/$REPO"
hacer gcloud iam service-accounts add-iam-policy-binding "$CORREO" --project "$PROYECTO" \
  --role="roles/iam.workloadIdentityUser" --member="$PRINCIPAL" --quiet

echo ""
echo "──────────────────────────────────────────────────────"
echo "  Ponga estas dos en GitHub → Settings → Secrets and variables →"
echo "  Actions → pestaña «Variables» → «New repository variable»:"
echo ""
echo "    WIF_PROVIDER"
echo "      projects/$NUMERO/locations/global/workloadIdentityPools/$DEPOSITO/providers/$PROVEEDOR"
echo ""
echo "    WIF_CUENTA"
echo "      $CORREO"
echo ""
[ "$APLICAR" = "0" ] && echo "  (Fue un ensayo: todavia no existe nada de esto.)" && echo ""
