import { conCredencial } from "@/lib/integraciones/api";
import { recibirExterno } from "@/lib/integraciones/compras-externas";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/recepciones — llegó la mercancía. Alcance compras:escribir.
 *
 * Exige Idempotency-Key: entrar el mismo embarque dos veces al inventario es
 * el error mas caro de esta ruta, y la clave se usa como clave de la recepcion
 * —con su indice unico— no solo para repetir la respuesta.
 */
export async function POST(request: Request) {
  const clave = request.headers.get("idempotency-key")?.trim() || null;
  return conCredencial(request, { alcance: "compras:escribir", ruta: "compras", exigeIdempotencia: true }, (quien, cuerpo) =>
    recibirExterno(quien, cuerpo, clave));
}
