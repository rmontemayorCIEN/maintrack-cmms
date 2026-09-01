import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { generarPlan } from "@/lib/ia/plan";

export const maxDuration = 300;

const schema = z.object({
  assetId: z.string().min(1),
  notas: z.string().trim().max(600).optional().nullable(),
});

/** Borrador de plan para un activo. No guarda nada: devuelve el borrador. */
export async function POST(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La funcion de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await generarPlan(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        { assetId: input.assetId, notas: input.notas, userId: user.id },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ formulario: r.formulario, justificacion: r.borrador.justificacion, faltantes: r.faltantes });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible generar el plan", 502);
    }
  });
}
