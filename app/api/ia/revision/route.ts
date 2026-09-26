import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada, motivoLegible } from "@/lib/ia/cliente";
import { revisarConfiguracion } from "@/lib/ia/revision";

export const maxDuration = 180;

/** Segunda opinion sobre como quedo configurada la cuenta. */
export async function POST() {
  return withAuth("settings:write", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La función de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    try {
      const r = await revisarConfiguracion(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        { userId: user.id, operador: user.isSuperAdmin },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ revision: r.revision });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(motivoLegible(error), 502);
    }
  });
}
