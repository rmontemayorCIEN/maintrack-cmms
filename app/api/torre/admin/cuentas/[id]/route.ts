import { conTorre, detalleParaTorre, responder } from "@/lib/torre/cuentas";

/** Administracion desde la Torre de Control: una empresa. Verla queda en la bitacora del operador. */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return conTorre(request, async (carga) => {
    const d = await detalleParaTorre(carga, id.slice(0, 100));
    return d ? responder(d) : responder(null, 404);
  });
}
