import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { aplicarCentrosSugeridos } from "@/lib/centros-sugeridos";

/**
 * Da de alta los centros de costo que suele tener una instalacion como la del
 * cliente. No pisa nada: lo que ya exista con esa clave se respeta.
 */
export async function POST() {
  return withAuth("settings:write", async ({ orgId, user }) => {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { tipoInstalacion: true },
    });
    const r = await aplicarCentrosSugeridos({ organizationId: orgId, tipoInstalacion: org?.tipoInstalacion });
    if (!r.creados.length) {
      return fail("Ya tiene dados de alta todos los que se proponen para su tipo de instalación", 409);
    }
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Catalogo", entityId: orgId, action: "CREATED",
      summary: `Se dieron de alta ${r.creados.length} centro(s) de costo propuestos: ${r.creados.map((c) => c.code).join(", ")}`,
    });
    return ok({ creados: r.creados, yaExistian: r.yaExistian }, 201);
  });
}
