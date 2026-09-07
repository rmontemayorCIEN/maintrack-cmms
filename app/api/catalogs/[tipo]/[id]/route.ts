import { CATALOGOS, esCatalogoValido } from "@/lib/catalogs";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ tipo: string; id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { tipo, id } = await params;
  if (!esCatalogoValido(tipo)) return fail("Catálogo desconocido", 404);
  const catalogo = CATALOGOS[tipo];

  return withAuth("settings:write", async ({ user, orgId }) => {
    const datos = catalogo.editar.parse(await request.json());
    try {
      const r = (await catalogo.actualizar(orgId, id, datos as Record<string, unknown>)) as { count?: number };
      if (r?.count === 0) return fail("Registro no encontrado", 404);
      await logAudit({
        organizationId: orgId,
        userId: user.id,
        entity: `Catalogo:${tipo}`,
        entityId: id,
        action: "UPDATED",
        summary: `Edicion de ${catalogo.singular}`,
        changes: datos,
      });
      const items = await catalogo.listar(orgId);
      return ok({ items });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "";
      if (mensaje.includes("Unique constraint") || mensaje.includes("UNIQUE")) {
        return fail("Ya existe un registro con ese código en este catálogo", 409);
      }
      throw error;
    }
  });
}

/** Baja. Nunca se borra algo en uso: se explica que lo impide. */
export async function DELETE(_request: Request, { params }: Params) {
  const { tipo, id } = await params;
  if (!esCatalogoValido(tipo)) return fail("Catálogo desconocido", 404);
  const catalogo = CATALOGOS[tipo];

  return withAuth("settings:write", async ({ user, orgId }) => {
    const bloqueo = await catalogo.bloqueoDeBorrado(orgId, id);
    if (bloqueo) return fail(bloqueo, 409);

    const r = (await catalogo.borrar(orgId, id)) as { count?: number };
    if (r?.count === 0) return fail("Registro no encontrado", 404);

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: `Catalogo:${tipo}`,
      entityId: id,
      action: "DELETED",
      summary: `Baja de ${catalogo.singular}`,
    });
    const items = await catalogo.listar(orgId);
    return ok({ items });
  });
}
