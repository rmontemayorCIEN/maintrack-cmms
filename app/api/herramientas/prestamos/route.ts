import { fail, ok, withAuth } from "@/lib/api";
import { prestar } from "@/lib/herramientas";

/**
 * Presta una herramienta.
 *
 * Pide `inventory:write` —el mismo permiso que mover existencias— aunque el
 * prestamo no mueva valor: quien saca algo del almacen responde por ello, y
 * ese es justo el conjunto de gente que ya tiene ese permiso.
 */
export async function POST(req: Request) {
  return withAuth("inventory:write", async ({ orgId, user }) => {
    const cuerpo = (await req.json().catch(() => null)) as
      | { partId?: string; warehouseId?: string; personaId?: string; cantidad?: number; estadoSalida?: string; proposito?: string; nota?: string; autoservicio?: boolean }
      | null;
    if (!cuerpo?.partId || !cuerpo?.warehouseId || !cuerpo?.personaId) {
      return fail("Falta qué herramienta, de qué almacén y para quién");
    }

    const r = await prestar({
      organizationId: orgId,
      partId: cuerpo.partId,
      warehouseId: cuerpo.warehouseId,
      personaId: cuerpo.personaId,
      cantidad: cuerpo.cantidad,
      /*
       * En autoservicio quien registra ES quien se la lleva, asi que no hay
       * segunda firma y NO se inventa una: poner ahi al mismo usuario haria
       * creer que alguien la entrego y reviso. `lib/herramientas.ts` exige la
       * firma cuando el almacen es de mostrador.
       */
      entregadoPorId: cuerpo.autoservicio ? null : user.id,
      estadoSalida: cuerpo.estadoSalida,
      proposito: cuerpo.proposito,
      nota: cuerpo.nota,
    });
    return r.ok ? ok({ resguardo: r.dato }, 201) : fail(r.motivo, r.codigo ?? 409);
  });
}
