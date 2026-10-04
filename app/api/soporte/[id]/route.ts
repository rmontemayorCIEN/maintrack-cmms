import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { seguimientoCliente } from "@/lib/soporte";

const esquema = z.object({
  nota: z.string().trim().max(2000).optional().nullable(),
  severidad: z.enum(["CRITICA", "ALTA", "MEDIA", "BAJA"]).optional().nullable(),
  confirmarResuelta: z.boolean().optional(),
});

/** Seguimiento del cliente sobre su propia solicitud (o, la administración, sobre las de su empresa). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(null, async ({ user, orgId }) => {
    const s = await prisma.solicitudSoporte.findFirst({ where: { id, organizationId: orgId }, select: { userId: true } });
    if (!s || (s.userId !== user.id && !can(user.role, "settings:write"))) return fail("Solicitud no encontrada", 404);
    const r = await seguimientoCliente({ organizationId: orgId, userId: user.id, id, ...esquema.parse(await request.json()) });
    return r ? ok({ solicitud: { id: r.id, estado: r.estado, severidad: r.severidad } }) : fail("Solicitud no encontrada", 404);
  });
}
