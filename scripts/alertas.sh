#!/usr/bin/env bash
#
# Las alertas de operacion de MainTrack, en Google Cloud. Bloque 8, seccion 7.
#
# El problema que resuelven: el sistema ya REGISTRA lo que pasa (procesos
# programados, entregas fallidas, errores con contexto), pero nada SALE a
# buscar a una persona. Si el servicio se cae a las dos de la manana, uno se
# entera cuando llama el cliente.
#
# Se crean por la API REST y no a mano en la consola para que existan escritas
# —que umbral, sobre que metrica, a quien avisa— y se puedan volver a crear en
# otro proyecto. Correrlo dos veces no duplica nada: lo que ya existe se
# reconoce por su nombre y se deja igual.
#
#   ./scripts/alertas.sh            # crea lo que falte
#   ./scripts/alertas.sh --listar   # solo muestra lo que hay
#
# El correo de destino se toma de CORREO_ALERTAS, o del canal que ya exista.
set -euo pipefail
source "$(dirname "$0")/proyecto.sh"
cd "$(dirname "$0")/.."

PROYECTO="maintrack-cmms-4821"
SERVICIO="maintrack-cmms"
INSTANCIA="maintrack-db"
URL_SERVICIO="maintrack-cmms-kgvakdu5hq-uc.a.run.app"
CANAL_NOMBRE="MainTrack — operador"
API="https://monitoring.googleapis.com/v3/projects/$PROYECTO"

TOKEN=$(gcloud auth print-access-token)
llamar() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }

if [ "${1:-}" = "--listar" ]; then
  echo "Canales:"
  llamar "$API/notificationChannels" | python3 -c "
import json,sys
for c in json.load(sys.stdin).get('notificationChannels', []):
    print(f\"  {c['displayName']:34} {c['type']:8} {c.get('labels',{}).get('email_address','')}\")"
  echo ""
  echo "Alertas:"
  llamar "$API/alertPolicies" | python3 -c "
import json,sys
for p in json.load(sys.stdin).get('alertPolicies', []):
    print(f\"  {'activa  ' if p.get('enabled') else 'apagada '} {p['displayName']}\")"
  echo ""
  echo "Revisiones de disponibilidad:"
  llamar "$API/uptimeCheckConfigs" | python3 -c "
import json,sys
for u in json.load(sys.stdin).get('uptimeCheckConfigs', []):
    print(f\"  {u['displayName']} cada {u.get('period','?')}\")"
  exit 0
fi

# ── El canal: a donde llegan los avisos ──────────────────────────────────────
CANAL=$(llamar "$API/notificationChannels" | python3 -c "
import json,sys
canales = json.load(sys.stdin).get('notificationChannels', [])
print(next((c['name'] for c in canales if c['displayName'] == '''$CANAL_NOMBRE'''), ''))")

if [ -z "$CANAL" ]; then
  CORREO="${CORREO_ALERTAS:-}"
  [ -z "$CORREO" ] && { echo "ERROR: no hay canal y no se indico CORREO_ALERTAS."; exit 1; }
  CANAL=$(llamar -X POST "$API/notificationChannels" -d "{
    \"type\": \"email\", \"displayName\": \"$CANAL_NOMBRE\", \"enabled\": true,
    \"description\": \"Avisos de operacion de MainTrack.\",
    \"labels\": { \"email_address\": \"$CORREO\" }
  }" | python3 -c "import json,sys; print(json.load(sys.stdin)['name'])")
  echo "Canal creado: $CANAL"
else
  echo "Canal: $CANAL"
fi

# ── Revision de disponibilidad: ¿contesta el servicio? ───────────────────────
HAY_UPTIME=$(llamar "$API/uptimeCheckConfigs" | python3 -c "
import json,sys
u = json.load(sys.stdin).get('uptimeCheckConfigs', [])
print(next((x['name'] for x in u if x['displayName'] == 'MainTrack responde'), ''))")

if [ -z "$HAY_UPTIME" ]; then
  # Contra /login a proposito: es la pantalla que responde sin sesion y que
  # obliga a que la base conteste, asi que una caida de Cloud SQL tambien se
  # nota. Una raiz que solo sirve HTML estatico diria «todo bien» con la base
  # muerta.
  HAY_UPTIME=$(llamar -X POST "$API/uptimeCheckConfigs" -d "{
    \"displayName\": \"MainTrack responde\",
    \"monitoredResource\": { \"type\": \"uptime_url\", \"labels\": { \"host\": \"$URL_SERVICIO\", \"project_id\": \"$PROYECTO\" } },
    \"httpCheck\": { \"path\": \"/login\", \"port\": 443, \"useSsl\": true, \"validateSsl\": true, \"requestMethod\": \"GET\" },
    \"period\": \"300s\", \"timeout\": \"10s\"
  }" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('name',''))")
  echo "Revision de disponibilidad creada: $HAY_UPTIME"
fi
ID_UPTIME="${HAY_UPTIME##*/}"

# ── Las politicas ────────────────────────────────────────────────────────────
crear_politica() {
  local nombre="$1" cuerpo="$2"
  local existe
  existe=$(llamar "$API/alertPolicies" | python3 -c "
import json,sys
ps = json.load(sys.stdin).get('alertPolicies', [])
print(next((p['name'] for p in ps if p['displayName'] == '''$nombre'''), ''))")
  if [ -n "$existe" ]; then echo "  ya existe: $nombre"; return; fi
  local r
  r=$(llamar -X POST "$API/alertPolicies" -d "$cuerpo")
  if echo "$r" | grep -q '"name"'; then echo "  creada:    $nombre"
  else echo "  ERROR en «$nombre»: $(echo "$r" | head -c 400)"; fi
}

echo "Alertas:"

crear_politica "MainTrack no responde" "{
  \"displayName\": \"MainTrack no responde\",
  \"documentation\": { \"content\": \"El servicio dejo de contestar en /login. Revise Cloud Run (revision desplegada, arranque) y Cloud SQL (instancia arriba, conexiones). Registros: gcloud run services logs read $SERVICIO --region us-central1\", \"mimeType\": \"text/markdown\" },
  \"combiner\": \"OR\",
  \"conditions\": [{
    \"displayName\": \"La revision de disponibilidad falla\",
    \"conditionThreshold\": {
      \"filter\": \"metric.type=\\\"monitoring.googleapis.com/uptime_check/check_passed\\\" AND resource.type=\\\"uptime_url\\\" AND metric.label.check_id=\\\"$ID_UPTIME\\\"\",
      \"aggregations\": [{ \"alignmentPeriod\": \"300s\", \"perSeriesAligner\": \"ALIGN_FRACTION_TRUE\" }],
      \"comparison\": \"COMPARISON_LT\", \"thresholdValue\": 0.4, \"duration\": \"300s\",
      \"trigger\": { \"count\": 1 }
    }
  }],
  \"notificationChannels\": [\"$CANAL\"],
  \"alertStrategy\": { \"autoClose\": \"1800s\" }
}"

crear_politica "MainTrack devuelve errores (5xx)" "{
  \"displayName\": \"MainTrack devuelve errores (5xx)\",
  \"documentation\": { \"content\": \"El servicio esta contestando con error a los usuarios. Busque el detalle con: gcloud run services logs read $SERVICIO --region us-central1 --limit 100 | grep 'falla interna'. Cada registro trae empresa y usuario.\", \"mimeType\": \"text/markdown\" },
  \"combiner\": \"OR\",
  \"conditions\": [{
    \"displayName\": \"Mas de 5 respuestas 5xx en 5 minutos\",
    \"conditionThreshold\": {
      \"filter\": \"metric.type=\\\"run.googleapis.com/request_count\\\" AND resource.type=\\\"cloud_run_revision\\\" AND resource.label.service_name=\\\"$SERVICIO\\\" AND metric.label.response_code_class=\\\"5xx\\\"\",
      \"aggregations\": [{ \"alignmentPeriod\": \"300s\", \"perSeriesAligner\": \"ALIGN_SUM\", \"crossSeriesReducer\": \"REDUCE_SUM\" }],
      \"comparison\": \"COMPARISON_GT\", \"thresholdValue\": 5, \"duration\": \"0s\",
      \"trigger\": { \"count\": 1 }
    }
  }],
  \"notificationChannels\": [\"$CANAL\"],
  \"alertStrategy\": { \"autoClose\": \"3600s\" }
}"

# La revision del «hombre muerto»: /api/salud contesta 503 cuando un proceso
# programado lleva mas de tres periodos sin terminar. La metrica de Cloud
# Scheduler no sirve para esto —no existe hasta que hay datos, y ademas mide
# intentos, no ausencias—, y un proceso que DEJO de correr no produce ninguna
# senal propia: hay que preguntarle a alguien que si conteste.
HAY_SALUD=$(llamar "$API/uptimeCheckConfigs" | python3 -c "
import json,sys
u = json.load(sys.stdin).get('uptimeCheckConfigs', [])
print(next((x['name'] for x in u if x['displayName'] == 'MainTrack esta sano'), ''))")

if [ -z "$HAY_SALUD" ]; then
  HAY_SALUD=$(llamar -X POST "$API/uptimeCheckConfigs" -d "{
    \"displayName\": \"MainTrack esta sano\",
    \"monitoredResource\": { \"type\": \"uptime_url\", \"labels\": { \"host\": \"$URL_SERVICIO\", \"project_id\": \"$PROYECTO\" } },
    \"httpCheck\": { \"path\": \"/api/salud\", \"port\": 443, \"useSsl\": true, \"validateSsl\": true, \"requestMethod\": \"GET\" },
    \"period\": \"300s\", \"timeout\": \"10s\"
  }" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('name',''))")
  echo "Revision de salud creada: $HAY_SALUD"
fi
ID_SALUD="${HAY_SALUD##*/}"

crear_politica "Un proceso programado dejo de correr" "{
  \"displayName\": \"Un proceso programado dejo de correr\",
  \"documentation\": { \"content\": \"/api/salud contesta 503: algun proceso programado lleva mas de tres periodos sin terminar una corrida, o acumula tres fallas seguidas. Abra esa direccion para ver cual, y el detalle en Empresas cliente › Procesos programados. Si la base no contesta, tambien cae aqui.\", \"mimeType\": \"text/markdown\" },
  \"combiner\": \"OR\",
  \"conditions\": [{
    \"displayName\": \"La revision de salud falla\",
    \"conditionThreshold\": {
      \"filter\": \"metric.type=\\\"monitoring.googleapis.com/uptime_check/check_passed\\\" AND resource.type=\\\"uptime_url\\\" AND metric.label.check_id=\\\"$ID_SALUD\\\"\",
      \"aggregations\": [{ \"alignmentPeriod\": \"600s\", \"perSeriesAligner\": \"ALIGN_FRACTION_TRUE\" }],
      \"comparison\": \"COMPARISON_LT\", \"thresholdValue\": 0.4, \"duration\": \"600s\",
      \"trigger\": { \"count\": 1 }
    }
  }],
  \"notificationChannels\": [\"$CANAL\"],
  \"alertStrategy\": { \"autoClose\": \"3600s\" }
}"

crear_politica "La base se esta llenando" "{
  \"displayName\": \"La base se esta llenando\",
  \"documentation\": { \"content\": \"El disco de Cloud SQL ($INSTANCIA) paso del 80 por ciento. Con el disco lleno la base deja de aceptar escrituras. Amplielo con: gcloud sql instances patch $INSTANCIA --storage-size=NN --project $PROYECTO\", \"mimeType\": \"text/markdown\" },
  \"combiner\": \"OR\",
  \"conditions\": [{
    \"displayName\": \"Disco por encima del 80 por ciento\",
    \"conditionThreshold\": {
      \"filter\": \"metric.type=\\\"cloudsql.googleapis.com/database/disk/utilization\\\" AND resource.type=\\\"cloudsql_database\\\"\",
      \"aggregations\": [{ \"alignmentPeriod\": \"300s\", \"perSeriesAligner\": \"ALIGN_MEAN\" }],
      \"comparison\": \"COMPARISON_GT\", \"thresholdValue\": 0.8, \"duration\": \"600s\",
      \"trigger\": { \"count\": 1 }
    }
  }],
  \"notificationChannels\": [\"$CANAL\"],
  \"alertStrategy\": { \"autoClose\": \"86400s\" }
}"

echo ""
echo "Listo. Revise con: ./scripts/alertas.sh --listar"
