import { conCredencial } from "@/lib/integraciones/api";
import { crearSolicitudExterna } from "@/lib/integraciones/entrada";

export const dynamic = "force-dynamic";

/** POST /api/v1/solicitudes — alcance solicitudes:crear. Recomendado: Idempotency-Key. */
export async function POST(request: Request) {
  return conCredencial(request, { alcance: "solicitudes:crear", ruta: "solicitudes" }, crearSolicitudExterna);
}
