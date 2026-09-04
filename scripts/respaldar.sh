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

PROYECTO="$(cd "$(dirname "$0")/.." && pwd)"
DIAS=7

cd "$PROYECTO"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "ERROR: esta carpeta no es un repositorio git."; exit 1; }

# --- Encontrar Google Drive -------------------------------------------------
# La app monta en ~/Library/CloudStorage/GoogleDrive-<cuenta>/. NO usar
# ~/Google Drive: una carpeta local con ese nombre pasa cualquier prueba de
# existencia y el respaldo termina en el mismo disco que el original. Eso
# ya paso —dos dias de respaldos que no salieron de la Mac.
RAIZ=$(ls -d "$HOME/Library/CloudStorage/GoogleDrive-"*/ 2>/dev/null | head -1 || true)

if [ -z "$RAIZ" ]; then
  echo "ERROR: Google Drive no esta instalado o no ha iniciado sesion."
  echo "       Se esperaba algo en ~/Library/CloudStorage/GoogleDrive-*/"
  exit 1
fi

RAIZ="${RAIZ%/}"   # ls -d deja una diagonal al final
UNIDAD="$RAIZ/My Drive"
[ -d "$UNIDAD" ] || UNIDAD="$RAIZ/Mi unidad"

# Que el volumen responda de verdad. Si Drive esta instalado pero no corriendo,
# la carpeta existe y toda operacion se queda colgada; sin este limite de
# tiempo el respaldo se congela en silencio.
if ! ( ls "$UNIDAD" >/dev/null 2>&1 & P=$!; ( sleep 15; kill -9 $P 2>/dev/null ) & W=$!; wait $P 2>/dev/null; R=$?; kill $W 2>/dev/null; exit $R ); then
  echo "ERROR: Google Drive no responde. Abra la aplicacion e inicie sesion."
  echo "       Ruta esperada: $UNIDAD"
  exit 1
fi

DESTINO="$UNIDAD/Respaldos MainTrack"
mkdir -p "$DESTINO"

# Prueba de escritura: que el archivo se pueda crear Y volver a leer.
SONDA="$DESTINO/.sonda-$$"
if ! ( echo ok > "$SONDA" 2>/dev/null && [ "$(cat "$SONDA" 2>/dev/null)" = "ok" ] ); then
  rm -f "$SONDA" 2>/dev/null || true
  echo "ERROR: no se puede escribir en $DESTINO"
  exit 1
fi
rm -f "$SONDA"

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

# --- Conservar por DIA, no por archivo --------------------------------------
# Contar archivos hace que varias corridas en un mismo dia se coman la
# historia: siete corridas hoy borran los siete dias anteriores.
HOY=$(date +%Y-%m-%d)

# De cada dia pasado, quedarse solo con el mas reciente.
for d in $(ls -1 "$DESTINO"/maintrack-*.bundle 2>/dev/null \
           | sed 's/.*maintrack-\(....-..-..\).*/\1/' | sort -u); do
  [ "$d" = "$HOY" ] && continue
  ls -1t "$DESTINO"/maintrack-"$d"-*.bundle 2>/dev/null | tail -n +2 \
    | while read -r viejo; do rm -f "$viejo"; done
done

# Y conservar solo los ultimos N dias.
for d in $(ls -1 "$DESTINO"/maintrack-*.bundle 2>/dev/null \
           | sed 's/.*maintrack-\(....-..-..\).*/\1/' | sort -ur | tail -n +$((DIAS + 1))); do
  rm -f "$DESTINO"/maintrack-"$d"-*.bundle
done

DIAS_VIVOS=$(ls -1 "$DESTINO"/maintrack-*.bundle 2>/dev/null \
             | sed 's/.*maintrack-\(....-..-..\).*/\1/' | sort -u | wc -l | tr -d ' ')
echo "  Se conservan $DIAS_VIVOS dias de respaldo."

echo ""
echo "Listo: $ARCHIVO"
echo ""
echo "Para restaurar en otra computadora:"
echo "  git clone \"$ARCHIVO\" CMMS-V1"
echo ""
echo "Falta el archivo .env, que a proposito no se respalda:"
echo "  sus valores se sacan de Secret Manager en la consola de Google Cloud."
