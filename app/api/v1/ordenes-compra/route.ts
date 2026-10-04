import { conCredencial } from "@/lib/integraciones/api";
import { colocarOrdenExterna } from "@/lib/integraciones/compras-externas";

export const dynamic = "force-dynamic";

/** POST /api/v1/ordenes-compra — el ERP informa el folio con que colocó la compra. Alcance compras:escribir. */
export async function POST(request: Request) {
  return conCredencial(request, { alcance: "compras:escribir", ruta: "compras" }, (quien, cuerpo) =>
    colocarOrdenExterna(quien, cuerpo));
}
