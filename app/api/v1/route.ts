import { NextResponse } from "next/server";
import { ALCANCES } from "@/lib/integraciones/alcances";
import { EVENTOS_WEBHOOK } from "@/lib/avisos/catalogo";

export const dynamic = "force-dynamic";

/** Índice de la API: versión, rutas y alcances. No requiere credencial ni devuelve datos. */
export async function GET() {
  return NextResponse.json({
    api: "MainTrack", version: "1",
    autenticacion: "Authorization: Bearer mt_<prefijo>_<secreto> (se crea en Configuración → Integración)",
    documentacion: "Docs/api-v1.md",
    rutas: {
      "GET /api/v1/activos": "activos:leer",
      "GET /api/v1/ubicaciones": "ubicaciones:leer",
      "GET /api/v1/ordenes": "ordenes:leer",
      "POST /api/v1/solicitudes": "solicitudes:crear",
      "POST /api/v1/lecturas": "lecturas:crear",
      "POST /api/v1/condiciones": "lecturas:crear",
      "GET /api/v1/inventario": "inventario:leer",
      "GET /api/v1/compras": "compras:leer",
      "POST /api/v1/ordenes-compra": "compras:escribir",
      "POST /api/v1/recepciones": "compras:escribir (+ Idempotency-Key)",
      "GET /api/v1/estado": "estado:leer",
      "POST /api/v1/eventos": "eventos:enviar (+ el alcance del tipo)",
    },
    alcances: ALCANCES,
    eventosDeWebhook: EVENTOS_WEBHOOK,
  }, { headers: { "MainTrack-Version": "1" } });
}
