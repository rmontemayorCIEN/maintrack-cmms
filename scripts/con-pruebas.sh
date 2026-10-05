#!/usr/bin/env bash
#
# Ejecuta un script contra la base de PRUEBAS, la de las versiones de prueba.
#
#   ./scripts/con-pruebas.sh scripts/sembrar-demo.ts --reemplazar
#
# Es el mismo puente que `con-produccion.sh` —abre la puerta de Cloud SQL, corre
# y la cierra— apuntando a la otra instancia. Vive en un archivo aparte, con
# nombre propio, para que se vea en el comando contra que base se esta
# trabajando: la diferencia entre las dos es los datos de tres clientes.
set -euo pipefail
cd "$(dirname "$0")/.."

MT_INSTANCIA_SQL="maintrack-db-pruebas" \
MT_SECRETO_DB="cmms-database-url-pruebas" \
  ./scripts/con-produccion.sh "$@"
