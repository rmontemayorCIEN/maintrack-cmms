import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { revisarSemana } from "@/lib/ia/agenda";

/** El modelo tarda de 15 a 60 s; sin esto la plataforma podria cortar antes. */
export const maxDuration = 120;

const schema = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use el formato AAAA-MM-DD").optional(),
});

export async function POST(request: Request) {
  return withAuth("workorder:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json().catch(() => ({})));

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, plan: true, iaComplemento: true, iaExtra: true },
    });
    if (!org) return fail("Organización no encontrada", 404);

    const desde = input.desde
      ? new Date(`${input.desde}T00:00:00`)
      : new Date();

    const resultado = await revisarSemana(org, { desde, userId: user.id });
    if (!resultado.ok) return fail(resultado.motivo, 422);

    return ok({ revision: resultado.revision, costoUsd: resultado.costoUsd });
  });
}
