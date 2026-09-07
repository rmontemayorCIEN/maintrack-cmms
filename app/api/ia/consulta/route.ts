import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { responderConsulta } from "@/lib/ia/consulta";

export const maxDuration = 300;

const schema = z.object({ pregunta: z.string().trim().min(5).max(500) });

/**
 * Consulta en lenguaje natural.
 *
 * Sin permiso de escritura: preguntar no cambia nada, y quien solo consulta
 * indicadores tambien deberia poder preguntar por ellos.
 */
export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La función de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await responderConsulta(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        { pregunta: input.pregunta, userId: user.id },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ respuesta: r.respuesta, consultas: r.consultas });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible responder", 502);
    }
  });
}
