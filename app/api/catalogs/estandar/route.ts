import { ok, withAuth } from "@/lib/api";
import { sembrarCatalogosEstandar } from "@/lib/catalogos-estandar";
import { logAudit } from "@/lib/audit";

/** Carga las listas estandar en los catalogos que esten vacios. */
export async function POST() {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const nuevos = await sembrarCatalogosEstandar(orgId);
    const total = Object.values(nuevos).reduce((s, n) => s + n, 0);

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Catalogo", entityId: orgId, action: "CREATED",
      summary: `Carga de catalogos estandar: ${total} registros`,
    });
    return ok({ nuevos, total }, 201);
  });
}
