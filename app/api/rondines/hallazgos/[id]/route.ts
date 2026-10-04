import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { resolverHallazgo } from "@/lib/rondin";

/**
 * Aceptar o descartar un hallazgo.
 *
 * Aceptarlo levanta una solicitud. Descartarlo lo deja registrado como
 * descartado en vez de borrarlo: saber que la maquina propuso algo y una
 * persona dijo que no es informacion —si se descarta siempre lo mismo, el
 * prompt esta mal calibrado y conviene enterarse—.
 */
const decision = z.object({ decision: z.enum(["ACEPTADO", "DESCARTADO"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const input = decision.parse(await request.json());
    const r = await resolverHallazgo(orgId, id, user.id, input.decision);
    if (!r.ok) return fail(r.motivo, 409);
    return ok({ solicitud: r.solicitud });
  });
}
