import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeAlmacen, almacenPorOmision, aplicarMovimiento } from "@/lib/almacen";

const schema = z.object({
  partId: z.string(),
  warehouseId: z.string().optional().nullable(),
  movementType: z.enum(["IN", "OUT", "ADJUST", "RETURN"]),
  quantity: z.coerce.number(),
  unitCost: z.coerce.number().min(0).optional(),
  reference: z.string().optional(),
});

/**
 * Entradas, salidas, ajustes y devoluciones de almacen.
 *
 * El calculo del saldo, el costo promedio y el kardex viven en lib/almacen.ts:
 * esta ruta solo valida lo que llega y decide a que almacen aplica cuando el
 * usuario no lo indico.
 */
export async function POST(request: Request) {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const warehouseId = input.warehouseId || (await almacenPorOmision(orgId))?.id;
    if (!warehouseId) return fail("La cuenta no tiene ningún almacén activo", 409);

    try {
      const balance = await aplicarMovimiento({
        organizationId: orgId,
        partId: input.partId,
        warehouseId,
        tipo: input.movementType,
        cantidad: input.quantity,
        costoUnitario: input.unitCost,
        referencia: input.reference,
        userId: user.id,
      });
      return ok({ balance }, 201);
    } catch (error) {
      if (error instanceof ErrorDeAlmacen) return fail(error.message, 422);
      throw error;
    }
  });
}
