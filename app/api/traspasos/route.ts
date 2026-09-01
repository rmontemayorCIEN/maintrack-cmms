import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeAlmacen, traspasar } from "@/lib/almacen";
import { siguienteFolio } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  origenId: z.string().min(1),
  destinoId: z.string().min(1),
  nota: z.string().trim().max(300).optional().nullable(),
  renglones: z.array(
    z.object({
      partId: z.string().min(1),
      cantidad: z.coerce.number().positive(),
    }),
  ).min(1).max(100),
});

/** Traspaso entre almacenes. La salida y la entrada cuadran o no ocurre nada. */
export async function POST(request: Request) {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    // El folio se toma antes de la transaccion a proposito: si el traspaso
    // falla se pierde un consecutivo, que es preferible a que dos traspasos
    // simultaneos peleen por el mismo numero dentro de la transaccion.
    const folio = await siguienteFolio(orgId, "traspaso");

    try {
      const traspaso = await traspasar({
        organizationId: orgId,
        folio,
        origenId: input.origenId,
        destinoId: input.destinoId,
        userId: user.id,
        nota: input.nota,
        renglones: input.renglones.map((r) => ({ partId: r.partId, cantidad: r.cantidad })),
      });

      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "StockTransfer", entityId: traspaso.id, action: "CREATED",
        summary: `Traspaso ${folio}: ${input.renglones.length} renglones`,
      });

      return ok({ id: traspaso.id, folio: traspaso.folio }, 201);
    } catch (error) {
      if (error instanceof ErrorDeAlmacen) return fail(error.message, 422);
      throw error;
    }
  });
}
