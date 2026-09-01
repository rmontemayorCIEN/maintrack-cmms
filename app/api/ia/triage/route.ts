import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { triarSolicitud } from "@/lib/ia/triage";

export const maxDuration = 120;

const schema = z.object({ requestId: z.string().min(1) });

/** Triage de una solicitud. Se dispara al abrirla, no al recibirla. */
export async function POST(request: Request) {
  return withAuth("request:review", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("El triage con inteligencia artificial no esta configurado en este servidor.", 503);
    }
    const { requestId } = schema.parse(await request.json());

    try {
      const r = await triarSolicitud(
        {
          id: orgId,
          plan: user.organization.plan,
          iaComplemento: user.organization.iaComplemento,
          iaExtra: user.organization.iaExtra,
        },
        { requestId, userId: user.id, operador: user.isSuperAdmin },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ triage: r.triage });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible analizar", 502);
    }
  });
}
