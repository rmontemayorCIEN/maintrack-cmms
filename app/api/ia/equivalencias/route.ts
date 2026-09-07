import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { proponerEquivalencias } from "@/lib/ia/equivalencias";

/** Propone equivalencias. No escribe nada: cada una se acepta por separado. */
export async function POST() {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, plan: true, iaComplemento: true, iaExtra: true },
    });
    if (!org) return fail("Organización no encontrada", 404);

    const r = await proponerEquivalencias(org, { userId: user.id });
    if (!r.ok) return fail(r.motivo, 422);
    return ok({ resumen: r.resumen, propuestas: r.propuestas, costoUsd: r.costoUsd });
  });
}
