import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { conciliarParada } from "@/lib/rondin";

/**
 * La conciliacion: decir de que equipo era una parada.
 *
 * `assetId` en nulo NO es un error ni un campo sin llenar: es «no es de ningun
 * equipo», y se guarda como tal. Obligar a elegir uno es como se acaban
 * atribuyendo hallazgos al equipo de al lado.
 */
const conciliacion = z.object({ assetId: z.string().nullable() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ orgId }) => {
    const input = conciliacion.parse(await request.json());
    const r = await conciliarParada(orgId, id, input.assetId);
    if (!r.ok) return fail(r.motivo, 404);
    return ok({ conciliada: true });
  });
}
