import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

/** Como opera el proceso de compras en esta organizacion. */
const schema = z.object({
  comprasInternas: z.boolean().optional(),
  montoAutorizacion: z.coerce.number().min(0).max(100_000_000).optional(),
});

export async function PATCH(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const datos = schema.parse(await request.json());
    if (!Object.keys(datos).length) return ok({ success: true });

    await prisma.organization.update({ where: { id: orgId }, data: datos });
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Organization", entityId: orgId, action: "UPDATED",
      summary: `Compras: ${datos.comprasInternas === undefined ? "" : datos.comprasInternas ? "proceso interno activado" : "proceso interno desactivado"}${datos.montoAutorizacion !== undefined ? ` umbral ${datos.montoAutorizacion}` : ""}`.trim(),
    });
    return ok({ success: true });
  });
}
