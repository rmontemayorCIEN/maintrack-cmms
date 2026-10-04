import { fail, ok, withAuth } from "@/lib/api";
import { darDeBaja } from "@/lib/herramientas";

/**
 * Da de baja una herramienta: se perdio, se la robaron, se rompio.
 *
 * Esto SI mueve existencia y dinero, asi que pasa por `aplicarMovimiento()`
 * como cualquier otra salida del almacen.
 */
export async function POST(req: Request) {
  return withAuth("inventory:write", async ({ orgId, user }) => {
    const cuerpo = (await req.json().catch(() => null)) as
      | { resguardoId?: string; partId?: string; warehouseId?: string; cantidad?: number; motivo?: string; nota?: string }
      | null;
    if (!cuerpo?.motivo) return fail("Falta decir por qué se da de baja");
    if (!cuerpo.resguardoId && !(cuerpo.partId && cuerpo.warehouseId)) {
      return fail("Falta decir qué herramienta se da de baja");
    }

    const r = await darDeBaja({
      organizationId: orgId,
      resguardoId: cuerpo.resguardoId,
      partId: cuerpo.partId,
      warehouseId: cuerpo.warehouseId,
      cantidad: cuerpo.cantidad,
      motivo: cuerpo.motivo,
      nota: cuerpo.nota,
      userId: user.id,
    });
    return r.ok ? ok({ baja: true, costo: r.dato.costo }, 201) : fail(r.motivo, r.codigo ?? 409);
  });
}
