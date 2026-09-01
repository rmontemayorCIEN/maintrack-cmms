import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(null, async ({ user, orgId }) => {
    const enlace = await prisma.referenceLink.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, title: true, assetId: true, partId: true, planId: true },
    });
    if (!enlace) return fail("Enlace no encontrado", 404);

    const permiso = enlace.assetId ? "asset:write" : enlace.partId ? "inventory:write" : "plan:write";
    if (!can(user.role, permiso)) return fail("Sin permisos suficientes", 403);

    await prisma.referenceLink.delete({ where: { id } });
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "ReferenceLink", entityId: id,
      action: "DELETED", summary: `Enlace "${enlace.title}" eliminado`,
    });
    return ok({ success: true });
  });
}
