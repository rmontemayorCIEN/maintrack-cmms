#!/usr/bin/env bash
# Corre TODAS las pruebas, y antes revisa que el entorno no las vaya a
# arruinar.
#
#   ./scripts/suite.sh
#
# Existe por tres accidentes que ya costaron caro, y que tienen en comun que
# NO se ven como problemas de entorno: se ven como decenas de pruebas rotas, y
# uno se pone a buscar el defecto en el codigo del dia.
#
#   1. El esquema apuntando a postgresql mientras la base local es SQLite.
#      Lo peor de este: no falla de inmediato. Las primeras pruebas pasan con
#      el cliente viejo, y en cuanto algo corre `prisma generate` —un build,
#      por ejemplo— todo lo que sigue revienta. Dos veces se diagnostico como
#      si fuera el cambio del dia.
#   2. Un servidor de desarrollo propio corriendo: las pruebas levantan el
#      suyo y compiten por `.next`.
#   3. Algo contra produccion en paralelo, que cambia el esquema debajo.
#
# Y al final separa las fallas ESPERADAS —las que dependen de la llave de IA o
# del build— de las que de verdad hay que mirar. «10 fallas» no dice nada;
# «0 inesperadas» si.
set -uo pipefail
cd "$(dirname "$0")/.."

echo ""
echo "Revisando el entorno…"

# ── 1. El esquema tiene que estar en SQLite.
PROVIDER=$(awk '/^datasource db \{/{d=1} d && /provider *=/{gsub(/.*= *"|"/, ""); print; exit}' prisma/schema.prisma)
if [ "$PROVIDER" != "sqlite" ]; then
  echo ""
  echo "  ERROR: el esquema apunta a «$PROVIDER» y la base local es SQLite."
  echo ""
  echo "  Asi no sirve correr la suite: las primeras pruebas pasarian con el"
  echo "  cliente viejo y el resto fallaria en cuanto algo regenere el cliente."
  echo ""
  echo "  Arreglelo con:  ./scripts/revert-sqlite.sh && npx prisma generate"
  echo ""
  exit 1
fi
echo "  ok  el esquema esta en SQLite"

# ── 2. Ningun servidor propio compitiendo por .next.
if pgrep -f "next (dev|start)" >/dev/null 2>&1; then
  echo ""
  echo "  ERROR: hay un servidor de desarrollo corriendo."
  echo ""
  echo "  Las pruebas levantan el suyo y compiten por .next: eso produce"
  echo "  errores 500 y tiempos de espera que no tienen que ver con el codigo."
  echo ""
  echo "  Apaguelo y vuelva a correr."
  echo ""
  exit 1
fi
echo "  ok  no hay servidores de desarrollo corriendo"

# ── 3. Que se sepa que esperamos que falle, y por que.
[ -n "${ANTHROPIC_API_KEY:-}" ] && HAY_IA=1 || HAY_IA=0
[ -f ".next/BUILD_ID" ] && HAY_BUILD=1 || HAY_BUILD=0
[ "$HAY_IA" = "1" ] && echo "  ok  hay llave de IA: las pruebas *-real deberian pasar" \
                    || echo "  --  sin llave de IA: las pruebas *-real van a fallar, y esta bien"
# El build de ahora puede no seguir ahi cuando le toque a responsiva: varias
# pruebas borran `.next`. Por eso esto es informativo y la clasificacion real
# se hace al momento de fallar.
[ "$HAY_BUILD" = "1" ] && echo "  ok  hay build (ojo: algunas pruebas borran .next mientras corren)" \
                       || echo "  --  sin build: prueba-responsiva va a fallar; correla aparte tras «npm run build»"

REGISTRO="${TMPDIR:-/tmp}/maintrack-suite-$(date +%H%M%S).log"
echo ""
echo "Corriendo las pruebas… (detalle en $REGISTRO)"
echo ""

ESPERADAS=()
INESPERADAS=()
PASARON=0

for f in scripts/prueba-*.ts; do
  NOMBRE=$(basename "$f" .ts)
  printf "  %-42s " "$NOMBRE"
  {
    echo ""
    echo "════════════════════════════════════════ $NOMBRE"
  } >> "$REGISTRO"

  if npx tsx "$f" >> "$REGISTRO" 2>&1; then
    echo "ok"
    PASARON=$((PASARON + 1))
    continue
  fi

  # ¿Era de las que ya sabemos que falla en este entorno?
  case "$NOMBRE" in
    *-real)
      if [ "$HAY_IA" = "0" ]; then echo "(sin llave de IA)"; ESPERADAS+=("$NOMBRE"); continue; fi ;;
    prueba-responsiva)
      if [ ! -f ".next/BUILD_ID" ]; then echo "(sin build)"; ESPERADAS+=("$NOMBRE"); continue; fi ;;
    prueba-rendimiento)
      # Conocida: no corre en esta maquina. Queda apuntada, no ignorada.
      echo "(conocida)"; ESPERADAS+=("$NOMBRE"); continue ;;
  esac

  echo "FALLA"
  INESPERADAS+=("$NOMBRE")
done

echo ""
echo "──────────────────────────────────────────────────────"
echo "  Pasaron:      $PASARON"
echo "  Esperadas:    ${#ESPERADAS[@]}${ESPERADAS:+  (${ESPERADAS[*]})}"
echo "  INESPERADAS:  ${#INESPERADAS[@]}${INESPERADAS:+  (${INESPERADAS[*]})}"
echo ""

if [ ${#INESPERADAS[@]} -gt 0 ]; then
  echo "  Hay fallas que revisar. El detalle esta en:"
  echo "    $REGISTRO"
  echo ""
  exit 1
fi

echo "  ✓ Nada inesperado."
echo ""
