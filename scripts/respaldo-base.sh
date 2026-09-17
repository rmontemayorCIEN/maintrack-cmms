#!/usr/bin/env bash
#
# Respaldo manual de la base de produccion y limpieza de los viejos.
#
#   bash scripts/respaldo-base.sh "Antes de migrar X"      # respalda y limpia
#   bash scripts/respaldo-base.sh --solo-revisar           # dice que borraria, no borra
#
# Por que existe: el respaldo manual antes de una migracion marca el punto
# exacto previo al cambio y, a diferencia de los automaticos (diarios, se
# conservan 7), NO caduca solo. Se hacia uno por migracion y se acumularon
# trece; los de hace un mes ya no sirven —nadie regresa la base tres semanas
# perdiendo toda la captura— y solo cuestan.
#
# Regla de limpieza, en este orden:
#   1. Solo se limpia DESPUES de un respaldo nuevo exitoso. Si el respaldo
#      falla, no se borra nada.
#   2. Solo respaldos ON_DEMAND. Los automaticos los administra Cloud SQL.
#   3. Solo los de mas de DIAS_RETENCION dias.
#   4. Siempre quedan al menos MINIMO_A_CONSERVAR manuales, aunque sean viejos.
#
# La proteccion diaria no depende de esto: respaldo automatico (7) y
# recuperacion a un momento exacto de los ultimos 7 dias.
set -euo pipefail
source "$(dirname "$0")/proyecto.sh"

INSTANCIA_SQL=maintrack-db
DIAS_RETENCION=30
MINIMO_A_CONSERVAR=3

SOLO_REVISAR=0
DESCRIPCION="Respaldo manual"
for arg in "$@"; do
  if [ "$arg" = "--solo-revisar" ]; then SOLO_REVISAR=1; else DESCRIPCION="$arg"; fi
done

if [ "$SOLO_REVISAR" = "0" ]; then
  echo "     Respaldando la base: $DESCRIPCION"
  gcloud sql backups create --instance="$INSTANCIA_SQL" --description="$DESCRIPCION" --quiet >/dev/null
  ULTIMO=$(gcloud sql backups list --instance="$INSTANCIA_SQL" --limit=1 --format="value(id,status)")
  case "$ULTIMO" in
    *SUCCESSFUL) echo "     Respaldo ${ULTIMO%%[[:space:]]*} listo." ;;
    *) echo "     ERROR: el respaldo no quedo exitoso ($ULTIMO). No se limpia nada."; exit 1 ;;
  esac
fi

# Manuales, del mas reciente al mas viejo: id y fecha.
LISTA=$(gcloud sql backups list --instance="$INSTANCIA_SQL" \
  --filter="type=ON_DEMAND AND status=SUCCESSFUL" \
  --sort-by="~windowStartTime" --format="value(id,windowStartTime)")

A_BORRAR=$(printf '%s\n' "$LISTA" | python3 -c '
import sys, datetime
dias, minimo = int(sys.argv[1]), int(sys.argv[2])
limite = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=dias)
filas = [l.split() for l in sys.stdin if l.strip()]
for i, (ident, fecha) in enumerate(filas):
    if i < minimo:
        continue
    if datetime.datetime.fromisoformat(fecha.replace("Z", "+00:00")) < limite:
        print(ident, fecha[:10])
' "$DIAS_RETENCION" "$MINIMO_A_CONSERVAR")

if [ -z "$A_BORRAR" ]; then
  echo "     Respaldos manuales: ninguno con mas de $DIAS_RETENCION dias por limpiar."
  exit 0
fi

while read -r ID FECHA; do
  if [ "$SOLO_REVISAR" = "1" ]; then
    echo "     Se borraria el respaldo $ID ($FECHA)."
  elif gcloud sql backups delete "$ID" --instance="$INSTANCIA_SQL" --quiet >/dev/null 2>&1; then
    echo "     Borrado respaldo manual $ID ($FECHA), mas de $DIAS_RETENCION dias."
  else
    echo "     Aviso: no se pudo borrar el respaldo $ID ($FECHA)."
  fi
done <<< "$A_BORRAR"
