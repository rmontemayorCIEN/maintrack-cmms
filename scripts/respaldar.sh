#!/bin/bash
#
# Respaldo del repositorio completo a Google Drive.
#
# POR QUE UN SOLO ARCHIVO Y NO LA CARPETA:
# Google Drive sincroniza archivo por archivo y no entiende que git necesita
# que ciertos cambios entren completos o no entren. Sincronizar .git puede
# dejar el historial corrupto sin aviso. Un "bundle" es UN archivo con todo
# adentro —cada commit, cada rama— y de ahi se reconstruye el repositorio
# entero. Sin sincronizacion parcial, sin corrupcion posible.
#
# Uso:  ./scripts/respaldar.sh
set -euo pipefail

DESTINO="$HOME/Google Drive/Respaldos MainTrack"
PROYECTO="$(cd "$(dirname "$0")/.." && pwd)"
CONSERVAR=7

cd "$PROYECTO"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "ERROR: esta carpeta no es un repositorio git."; exit 1; }

[ -d "$HOME/Google Drive" ] \
  || { echo "ERROR: no encuentro Google Drive en $HOME/Google Drive"; exit 1; }

mkdir -p "$DESTINO"

# Avisar si hay trabajo sin guardar: el respaldo solo lleva lo confirmado.
PENDIENTES=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$PENDIENTES" != "0" ]; then
  echo ""
  echo "  AVISO: hay $PENDIENTES cambios sin guardar como punto."
  echo "  El respaldo NO los incluye. Para incluirlos, primero:"
  echo "      git add -A && git commit -m \"lo que hizo\""
  echo ""
fi

FECHA=$(date +%Y-%m-%d-%H%M)
ARCHIVO="$DESTINO/maintrack-$FECHA.bundle"

echo "Empacando el repositorio completo..."
git bundle create "$ARCHIVO" --all 2>&1 | sed 's/^/  /'

# Verificar que el respaldo sirve. Un respaldo que no se probo no es respaldo.
echo "Verificando..."
if git bundle verify "$ARCHIVO" >/dev/null 2>&1; then
  TAM=$(du -h "$ARCHIVO" | cut -f1 | tr -d ' ')
  PUNTOS=$(git rev-list --all --count)
  echo "  Integro: $PUNTOS puntos de historia, $TAM"
else
  echo "  ERROR: el respaldo no paso la verificacion. Se borra."
  rm -f "$ARCHIVO"
  exit 1
fi

# Conservar solo los ultimos, para no llenar el Drive.
BORRADOS=$(ls -1t "$DESTINO"/maintrack-*.bundle 2>/dev/null | tail -n +$((CONSERVAR + 1)) || true)
if [ -n "$BORRADOS" ]; then
  echo "$BORRADOS" | while read -r viejo; do rm -f "$viejo"; done
  echo "  Se conservan los ultimos $CONSERVAR respaldos."
fi

echo ""
echo "Listo: $ARCHIVO"
echo ""
echo "Para restaurar en otra computadora:"
echo "  git clone \"$ARCHIVO\" CMMS-V1"
echo ""
echo "Falta el archivo .env, que a proposito no se respalda:"
echo "  sus valores se sacan de Secret Manager en la consola de Google Cloud."
