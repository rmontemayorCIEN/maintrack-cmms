#!/usr/bin/env bash
# Saca de iCloud lo que no debe sincronizarse.
#
#   ./scripts/fuera-de-icloud.sh
#
# ── Por que existe ──
#
# ~/Documents en esta Mac ES iCloud Drive: no es un enlace visible, es un
# enlace firme de APFS, asi que el proyecto entero se sincroniza sin que se
# note. Con node_modules y .next dentro, eso son 1.9 GB subiendo y bajando, y
# iCloud resuelve los conflictos creando copias con " 2" en el nombre.
#
# Esas copias no son cosmeticas: 147 de ellas dentro de .next dejaron el
# servidor de desarrollo sirviendo los chunks del cliente con error 500. La
# pantalla cargaba, React nunca hidrataba, y todo lo interactivo quedaba
# muerto sin un solo mensaje que lo explicara. Costo dos diagnosticos.
#
# ── Por que hay que volver a correrlo ──
#
# `npm ci` borra node_modules antes de instalar, y con el se lleva el enlace.
# Despues vuelve a crear una carpeta de verdad, dentro de iCloud, y el
# problema regresa en silencio. Este script es idempotente: correrlo de mas no
# hace dano.
set -euo pipefail
cd "$(dirname "$0")/.."

FUERA="$HOME/Library/Caches/maintrack"
mkdir -p "$FUERA/next-cache" "$FUERA/node_modules"

enlazar() {
  local nombre="$1" destino="$2"
  if [ -L "$nombre" ]; then
    echo "     $nombre ya esta fuera de iCloud."
    return
  fi
  if [ -d "$nombre" ]; then
    echo "     Moviendo $nombre fuera de iCloud..."
    rm -rf "$destino"
    mv "$nombre" "$destino"
  fi
  ln -sfn "$destino" "$nombre"
  echo "     $nombre -> $destino"
}

echo ""
echo "Sacando de iCloud lo que no debe sincronizarse..."
enlazar ".next" "$FUERA/next-cache"
enlazar "node_modules" "$FUERA/node_modules"

# Las copias que iCloud ya haya creado. Se buscan fuera de node_modules
# porque ahi dentro no molestan y son miles.
COPIAS=$(find . -name "* [0-9].*" -not -path "./node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
if [ "$COPIAS" != "0" ]; then
  echo "     Limpiando $COPIAS copias que dejo iCloud..."
  find . -name "* [0-9].*" -not -path "./node_modules/*" -delete 2>/dev/null || true
fi

echo ""
echo "Listo. Lo que sigue en iCloud pesa $(du -sh . 2>/dev/null | cut -f1)."
echo ""
echo "  Falta lo de fondo: .env y prisma/dev.db siguen sincronizandose,"
echo "  porque estan en el arbol del proyecto. La solucion completa es sacar"
echo "  el proyecto de ~/Documents; mientras tanto, esto evita los conflictos"
echo "  que rompen el servidor de desarrollo."
echo ""
