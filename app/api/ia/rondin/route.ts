import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada, motivoLegible } from "@/lib/ia/cliente";
import { revisarFotosDelRondin } from "@/lib/ia/rondin";
import { guardarHallazgos } from "@/lib/rondin";

export const maxDuration = 300;

const schema = z.object({ rondinId: z.string().min(1) });

/**
 * Revisar las fotos de un recorrido.
 *
 * `workorder:execute` —el mismo que anotar la parada— porque lo pide quien
 * acaba de caminar la planta y tiene las fotos frescas en la cabeza. Exigirle
 * un permiso de administracion dejaria la revision en manos de alguien que no
 * estuvo ahi, que es justo quien peor puede juzgar si un hallazgo es cierto.
 *
 * Lo que devuelve son PROPUESTAS. No crea ordenes, no crea solicitudes y no
 * toca nada: eso pasa cuando una persona acepta un hallazgo, uno por uno.
 */
export async function POST(request: Request) {
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La función de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await revisarFotosDelRondin(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        { rondinId: input.rondinId, userId: user.id },
      );
      // 402 y no 500: no es que algo se rompiera, es que no se puede hacer
      // —sin plan, sin cupo, o sin fotos que mirar— y el motivo ya viene
      // redactado para leerse tal cual.
      if (!r.ok) return fail(r.motivo, 402);

      await guardarHallazgos(orgId, input.rondinId, r.hallazgos);
      return ok({ hallazgos: r.hallazgos.length, noSirven: r.noSirven, nota: r.nota });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(motivoLegible(error), 502);
    }
  });
}
