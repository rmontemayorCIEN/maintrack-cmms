import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { sugerirCierre } from "@/lib/ia/cierre";

export const maxDuration = 120;

const schema = z.object({
  workOrderId: z.string().min(1),
  texto: z.string().trim().min(10).max(4000),
});

/**
 * Sugerencia de codificacion al cerrar una orden.
 *
 * Lo pide quien ejecuta el trabajo, que es quien esta cerrando: si requiriera
 * un permiso de administracion, el tecnico —el unico que sabe lo que paso—
 * no podria usarlo, y la ayuda no serviria de nada.
 */
export async function POST(request: Request) {
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La función de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await sugerirCierre(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        { workOrderId: input.workOrderId, texto: input.texto, userId: user.id },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ sugerencia: r.sugerencia });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible generar la sugerencia", 502);
    }
  });
}
