import { conCredencial } from "@/lib/integraciones/api";
import { listarComprasExternas } from "@/lib/integraciones/compras-externas";

export const dynamic = "force-dynamic";

/** GET /api/v1/compras?estado=&limite=&cursor= — requisiciones de compra. Alcance compras:leer. */
export async function GET(request: Request) {
  return conCredencial(request, { alcance: "compras:leer", ruta: "compras" }, (quien) =>
    listarComprasExternas(quien, new URL(request.url)));
}
