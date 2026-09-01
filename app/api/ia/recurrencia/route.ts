import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { analizarRecurrencia } from "@/lib/ia/recurrencia";

export const maxDuration = 180;

const schema = z.object({
  assetId: z.string().min(1),
  dias: z.coerce.number().int().min(30).max(1095).default(365),
});

export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("El analisis de recurrencia no esta configurado en este servidor.", 503);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await analizarRecurrencia(
        {
          id: orgId,
          plan: user.organization.plan,
          iaComplemento: user.organization.iaComplemento,
          iaExtra: user.organization.iaExtra,
        },
        { assetId: input.assetId, dias: input.dias, userId: user.id, operador: user.isSuperAdmin },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ analisis: r.analisis });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible analizar", 502);
    }
  });
}
