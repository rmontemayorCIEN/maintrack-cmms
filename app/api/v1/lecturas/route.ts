import { conCredencial } from "@/lib/integraciones/api";
import { registrarLecturaExterna } from "@/lib/integraciones/entrada";

export const dynamic = "force-dynamic";

/** POST /api/v1/lecturas — lectura de medidor (horas, km, ciclos). Alcance lecturas:crear. */
export async function POST(request: Request) {
  return conCredencial(request, { alcance: "lecturas:crear", ruta: "lecturas" }, registrarLecturaExterna);
}
