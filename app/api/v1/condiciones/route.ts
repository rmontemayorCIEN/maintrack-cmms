import { conCredencial } from "@/lib/integraciones/api";
import { registrarCondicionExterna } from "@/lib/integraciones/entrada";

export const dynamic = "force-dynamic";

/** POST /api/v1/condiciones — lectura de un sensor (temperatura, vibración, presión…). Alcance lecturas:crear. */
export async function POST(request: Request) {
  return conCredencial(request, { alcance: "lecturas:crear", ruta: "lecturas" }, registrarCondicionExterna);
}
