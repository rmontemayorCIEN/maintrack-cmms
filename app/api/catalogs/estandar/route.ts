import { ok, withAuth } from "@/lib/api";
import { sembrarCatalogosEstandar } from "@/lib/catalogos-estandar";
import { logAudit } from "@/lib/audit";

/** Carga las listas estandar en los catalogos que esten vacios. */
export async function POST() {
  return withAuth("settings:write", async ({ user, orgId }) => {
    // Los del tipo de instalación de la empresa, no una lista industrial para todos.
    const nuevos = await sembrarCatalogosEstandar(orgId, user.organization.tipoInstalacion);
    const total = Object.values(nuevos).reduce((s, n) => s + n, 0);

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Catalogo", entityId: orgId, action: "CATALOGS_SEEDED",
      summary: `Carga de catálogos estándar (${user.organization.tipoInstalacion ?? "sin tipo"}): ${total} registros`,
      changes: nuevos,
    });
    return ok({ nuevos, total }, 201);
  });
}
