import { CATALOGOS, esCatalogoValido } from "@/lib/catalogs";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { verificarCupo } from "@/lib/planes";

type Params = { params: Promise<{ tipo: string }> };

/** Listado de un catalogo. Cualquier usuario autenticado puede consultarlo:
 *  los campos de seleccion de las pantallas de captura dependen de esto. */
export async function GET(_request: Request, { params }: Params) {
  const { tipo } = await params;
  if (!esCatalogoValido(tipo)) return fail("Catalogo desconocido", 404);

  return withAuth(null, async ({ orgId }) => {
    const items = await CATALOGOS[tipo].listar(orgId);
    return ok({ items });
  });
}

/** Alta. Requiere permiso de escritura de catalogos. */
export async function POST(request: Request, { params }: Params) {
  const { tipo } = await params;
  if (!esCatalogoValido(tipo)) return fail("Catalogo desconocido", 404);
  const catalogo = CATALOGOS[tipo];

  return withAuth("settings:write", async ({ user, orgId }) => {
    // Los sitios cuentan contra el plan; el resto de catalogos no.
    if (tipo === "sites") {
      const cupo = await verificarCupo(orgId, user.organization.plan, "sites");
      if (!cupo.permitido) return fail(cupo.mensaje, 402);
    }

    const datos = catalogo.crear.parse(await request.json());
    try {
      const creado = await catalogo.insertar(orgId, datos as Record<string, unknown>);
      await logAudit({
        organizationId: orgId,
        userId: user.id,
        entity: `Catalogo:${tipo}`,
        entityId: creado.id,
        action: "CREATED",
        summary: `Alta de ${catalogo.singular}`,
        changes: datos,
      });
      const items = await catalogo.listar(orgId);
      return ok({ id: creado.id, items }, 201);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : "";
      // El esquema declara codigos unicos por organizacion.
      if (mensaje.includes("Unique constraint") || mensaje.includes("UNIQUE")) {
        return fail("Ya existe un registro con ese codigo en este catalogo", 409);
      }
      throw error;
    }
  });
}
