import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { revisarEquipo } from "@/lib/ia/equipo";
import { can } from "@/lib/rbac";

/** Revisa al equipo. Solo para quien ve al equipo completo. */
export async function POST() {
  return withAuth(null, async ({ user, orgId }) => {
    if (!can(user.role, "workorder:write")) {
      return fail("Solo supervisores y arriba pueden revisar al equipo completo.", 403);
    }
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, plan: true, iaComplemento: true, iaExtra: true },
    });
    if (!org) return fail("Organización no encontrada", 404);

    const r = await revisarEquipo(org, { userId: user.id });
    if (!r.ok) return fail(r.motivo, 422);
    return ok({ revision: r.revision, costoUsd: r.costoUsd });
  });
}
