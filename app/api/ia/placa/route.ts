import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada, motivoLegible } from "@/lib/ia/cliente";
import { leerPlaca } from "@/lib/ia/placa";

export const maxDuration = 180;

/** ~7 MB en base64 ≈ 5 MB de foto: mas que suficiente para una placa. */
const schema = z.object({
  base64: z.string().min(100).max(7_000_000),
  tipo: z.enum(["image/jpeg", "image/png", "image/webp"]),
  contexto: z.string().trim().max(200).optional().nullable(),
});

export async function POST(request: Request) {
  return withAuth("asset:write", async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("La función de inteligencia artificial no esta configurada en este servidor.", 503);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await leerPlaca(
        { id: orgId, plan: user.organization.plan, iaComplemento: user.organization.iaComplemento, iaExtra: user.organization.iaExtra },
        { base64: input.base64, tipo: input.tipo, contexto: input.contexto, userId: user.id, operador: user.isSuperAdmin },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ lectura: r.lectura });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(motivoLegible(error), 502);
    }
  });
}
