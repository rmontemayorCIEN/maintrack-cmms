# El proyecto de Google Cloud de MainTrack, fijo.
#
# Todos los scripts que llaman a gcloud cargan este archivo:
#
#   source "$(dirname "$0")/proyecto.sh"
#
# Antes cada uno tomaba el proyecto de la configuracion GLOBAL de gcloud, que
# es de la computadora y no de este repositorio. En cuanto Rafael trabajaba en
# otro proyecto suyo, `actualizar` fallo buscando la base de datos en el
# proyecto equivocado —por suerte ahi—: `deploy.sh` arma con ese mismo valor el
# nombre del bucket de archivos, y habria publicado MainTrack dentro del otro
# proyecto, sin base de datos y sin llaves. Es la misma clase de accidente que
# ya dejo un servicio `cmms` de mas.
#
# CLOUDSDK_CORE_PROJECT manda sobre la configuracion global SOLO para este
# proceso y sus hijos. No se toca la configuracion de la maquina, asi que lo que
# Rafael tenga abierto en su otro proyecto sigue igual.

MAINTRACK_PROYECTO="maintrack-cmms-4821"
export CLOUDSDK_CORE_PROJECT="$MAINTRACK_PROYECTO"

# Si la configuracion global apunta a otro lado, se dice —no para detenerse,
# sino para que nadie se sorprenda de ver otro proyecto en `gcloud config list`.
__global="$(env -u CLOUDSDK_CORE_PROJECT gcloud config get-value project 2>/dev/null || true)"
if [ -n "$__global" ] && [ "$__global" != "$MAINTRACK_PROYECTO" ]; then
  echo "     (gcloud apunta a '$__global' en esta maquina; este script usa '$MAINTRACK_PROYECTO')"
fi
unset __global
