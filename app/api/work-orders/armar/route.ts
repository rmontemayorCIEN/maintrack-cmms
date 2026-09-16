import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { armarOrden } from "@/lib/armar-ot";

const schema = z.object({
  assetId: z.string(),
  title: z.string().trim().min(3).max(200),
  assignedToId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  /**
   * Las actividades de plan que van en la orden, por id de actividad. Se eligen
   * sueltas: tres de las cinco de un plan pueden ir aqui y dos en otra orden.
   */
  actividades: z.array(z.string()).default([]),
  /** Los reportes de falla que se atienden en esta orden. */
  reportes: z.array(z.string()).default([]),
  /** Las actividades del backlog que se retoman. */
  backlog: z.array(z.string()).default([]),
});

/**
 * Arma una orden con trabajo de varios origenes.
 *
 * El encabezado se queda con el tipo que predomina, pero cada actividad
 * conserva el suyo: de ahi salen despues la clasificacion de paro y el codigo
 * de falla, y tomarlos del encabezado contaria un correctivo colado en un
 * preventivo como trabajo planeado.
 */
export async function POST(request: Request) {
  return withAuth("workorder:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const resultado = await armarOrden({
      organizationId: orgId,
      userId: user.id,
      ...input,
    });
    if ("error" in resultado) return fail(resultado.error, resultado.codigo);
    const orden = resultado.orden;

    return ok({ workOrder: orden }, 201);
  });
}
