import { z } from "zod";
import { conCredencial, ErrorApi } from "@/lib/integraciones/api";
import { crearSolicitudExterna, registrarCondicionExterna, registrarLecturaExterna } from "@/lib/integraciones/entrada";

export const dynamic = "force-dynamic";

const sobre = z.object({ tipo: z.enum(["solicitud", "lectura", "condicion"]), datos: z.unknown() });

/**
 * POST /api/v1/eventos — webhook ENTRANTE: un sistema externo (SCADA, pasarela
 * de sensores, sistema de producción) avisa algo a MainTrack.
 *
 * Alcance eventos:enviar, más el alcance del tipo (lecturas:crear o
 * solicitudes:crear). Exige Idempotency-Key: el mismo evento reenviado no se
 * procesa dos veces. Pasa por las mismas validaciones que la API.
 */
export async function POST(request: Request) {
  return conCredencial(request, { alcance: "eventos:enviar", ruta: "eventos", exigeIdempotencia: true }, async (quien, cuerpo) => {
    const s = sobre.safeParse(cuerpo);
    if (!s.success) throw new ErrorApi(422, "EVENTO_INVALIDO", "El evento debe ser { \"tipo\": \"solicitud\" | \"lectura\" | \"condicion\", \"datos\": { … } }.");
    const requiere = s.data.tipo === "solicitud" ? "solicitudes:crear" : "lecturas:crear";
    if (!quien.alcances.includes(requiere)) throw new ErrorApi(403, "ALCANCE_INSUFICIENTE", `Para eventos de tipo «${s.data.tipo}» la credencial necesita «${requiere}».`);
    if (s.data.tipo === "solicitud") return crearSolicitudExterna(quien, s.data.datos);
    if (s.data.tipo === "lectura") return registrarLecturaExterna(quien, s.data.datos);
    return registrarCondicionExterna(quien, s.data.datos);
  });
}
