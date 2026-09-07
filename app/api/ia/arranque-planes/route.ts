import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { proponerArranque } from "@/lib/ia/arranque-planes";

/** Propone por donde empezar el programa preventivo. No crea nada. */
export async function POST() {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, plan: true, iaComplemento: true, iaExtra: true },
    });
    if (!org) return fail("Organización no encontrada", 404);

    const r = await proponerArranque(org, { userId: user.id });
    if (!r.ok) return fail(r.motivo, 422);
    return ok({ propuesta: r.propuesta, costoUsd: r.costoUsd });
  });
}
