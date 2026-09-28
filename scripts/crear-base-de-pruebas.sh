#!/usr/bin/env bash
# La base de datos de las versiones de prueba. SEPARADA de la de los clientes.
#
#   ./scripts/crear-base-de-pruebas.sh              # ensayo
#   ./scripts/crear-base-de-pruebas.sh --aplicar    # la crea (EMPIEZA A COBRAR)
#
# ── Por que una instancia aparte y no otra base en la de produccion
#
# Otra base dentro de `maintrack-db` no cuesta nada, y por eso es la opcion
# comun. Aqui no sirve: `maintrack-db` es una db-f1-micro —nucleo compartido,
# 0.6 GB de RAM— y ya va justa. De ahi salio que una transaccion se pasara del
# limite de cinco segundos de Prisma y dejara la demo a medias en produccion,
# cuando en la Mac corria de sobra.
#
# Una version de prueba corre migraciones y a veces siembra datos. Eso, en la
# misma maquina que atiende a Casa Montemayor, Acero Industrial y Minerales
# Metalicos, es quitarles recursos a cambio de ahorrar diez dolares.
#
# ── Lo que cuesta
#
# Una db-f1-micro en us-central1, zonal, con 10 GB SSD: alrededor de 10 a 12
# dolares al mes. Se puede apagar cuando no se use; al encenderla otra vez
# conserva los datos.
set -euo pipefail
source "$(dirname "$0")/proyecto.sh"

INSTANCIA="maintrack-db-pruebas"
REGION="us-central1"
BASE="maintrack"
USUARIO="maintrack"
SECRETO="cmms-database-url-pruebas"
APLICAR=0
[ "${1:-}" = "--aplicar" ] && APLICAR=1

PROYECTO="$CLOUDSDK_CORE_PROJECT"

echo ""
echo "Proyecto : $PROYECTO"
echo "Instancia: $INSTANCIA (db-f1-micro, PostgreSQL 16, $REGION)"
echo "Secreto  : $SECRETO"
echo ""

if [ "$APLICAR" = "0" ]; then
  echo "  MODO ENSAYO. No se crea nada y no se cobra nada."
  echo ""
  echo "  Lo que haria:"
  echo "    1. Crear la instancia $INSTANCIA (db-f1-micro, 10 GB SSD, zonal)."
  echo "    2. Crear la base «$BASE» y el usuario «$USUARIO» con una clave al azar."
  echo "    3. Guardar la cadena de conexion en Secret Manager como «$SECRETO»."
  echo ""
  echo "  La clave se genera aqui y va DIRECTO al Secret Manager: no se imprime,"
  echo "  no se guarda en ningun archivo y no queda en el historial de la"
  echo "  terminal. La unica copia vive en Secret Manager."
  echo ""
  echo "  Cuesta alrededor de 10-12 USD al mes. Para hacerlo: --aplicar"
  echo ""
  exit 0
fi

if gcloud sql instances describe "$INSTANCIA" --project "$PROYECTO" >/dev/null 2>&1; then
  echo "1/4  La instancia ya existe; no se toca."
else
  echo "1/4  Creando la instancia (tarda varios minutos)..."
  # Sin respaldos automaticos ni alta disponibilidad: son datos de prueba que
  # se pueden volver a sembrar. Pagar por protegerlos seria pagar de mas.
  # --edition=ENTERPRISE no es opcional: las instancias nuevas nacen en
  # ENTERPRISE_PLUS, que NO admite db-f1-micro y rechaza la creacion con un
  # 400. Es ademas la edicion de maintrack-db, asi que la de pruebas se parece
  # a la de produccion, que es de lo que se trata.
  gcloud sql instances create "$INSTANCIA" --project "$PROYECTO" \
    --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro \
    --region="$REGION" \
    --storage-size=10 --storage-type=SSD --availability-type=ZONAL \
    --no-backup --quiet
fi

echo "2/4  La base..."
gcloud sql databases describe "$BASE" --instance="$INSTANCIA" --project "$PROYECTO" >/dev/null 2>&1 \
  || gcloud sql databases create "$BASE" --instance="$INSTANCIA" --project "$PROYECTO" --quiet

echo "3/4  El usuario..."
if gcloud sql users list --instance="$INSTANCIA" --project "$PROYECTO" --format="value(name)" | grep -qx "$USUARIO"; then
  echo "      ya existe; no se le cambia la clave para no invalidar el secreto."
else
  # La clave nace aqui y muere en Secret Manager. Nunca se imprime.
  CLAVE="$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)"
  gcloud sql users create "$USUARIO" --instance="$INSTANCIA" --project "$PROYECTO" \
    --password="$CLAVE" --quiet

  CONEXION=$(gcloud sql instances describe "$INSTANCIA" --project "$PROYECTO" --format="value(connectionName)")
  # Con el mismo formato que la de produccion: lo que la lee espera ese formato
  # exacto para sacarle la clave al migrar.
  CADENA="postgresql://$USUARIO:$CLAVE@localhost/$BASE?host=/cloudsql/$CONEXION"
  unset CLAVE

  echo "4/4  Guardando la cadena en Secret Manager..."
  if gcloud secrets describe "$SECRETO" --project "$PROYECTO" >/dev/null 2>&1; then
    printf '%s' "$CADENA" | gcloud secrets versions add "$SECRETO" --project "$PROYECTO" --data-file=-
  else
    printf '%s' "$CADENA" | gcloud secrets create "$SECRETO" --project "$PROYECTO" \
      --replication-policy=automatic --data-file=-
  fi
  unset CADENA
fi

echo ""
echo "──────────────────────────────────────────────────────"
echo "  Listo. Ponga estas dos mas en GitHub → Settings → Secrets and"
echo "  variables → Actions → «Variables»:"
echo ""
echo "    SQL_PRUEBAS            $INSTANCIA"
echo "    SECRETO_DB_PRUEBAS     $SECRETO"
echo ""
echo "  Mientras SQL_PRUEBAS no exista, el flujo de version de prueba no corre."
echo "  Es a proposito: mas vale no tener vista previa que tener una apuntando"
echo "  a los datos de los clientes."
echo ""
