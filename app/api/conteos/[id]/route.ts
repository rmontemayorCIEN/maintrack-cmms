import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeAlmacen } from "@/lib/almacen";
import { ErrorDeConteo, cancelarConteo, capturarConteo, cerrarConteo } from "@/lib/conteos";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("CAPTURAR"),
    renglones: z.array(
      z.object({
        lineId: z.string().min(1),
        cantidadContada: z.union([z.coerce.number().min(0), z.null()]),
        nota: z.string().trim().max(200).optional().nullable(),
      }),
    ).min(1).max(500),
  }),
  z.object({ accion: z.literal("CERRAR") }),
  z.object({ accion: z.literal("CANCELAR") }),
]);

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    try {
      if (input.accion === "CAPTURAR") {
        const r = await capturarConteo({ organizationId: orgId, countId: id, renglones: input.renglones });
        return ok(r);
      }
      if (input.accion === "CERRAR") {
        const r = await cerrarConteo({ organizationId: orgId, countId: id, userId: user.id });
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "InventoryCount", entityId: id, action: "CLOSED",
          summary: `Conteo ${r.folio} cerrado: ${r.contados} contados, ${r.ajustados} ajustados`,
        });
        return ok(r);
      }
      await cancelarConteo(orgId, id);
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "InventoryCount", entityId: id, action: "CANCELLED",
        summary: "Conteo cancelado",
      });
      return ok({ success: true });
    } catch (error) {
      if (error instanceof ErrorDeConteo || error instanceof ErrorDeAlmacen) return fail(error.message, 422);
      throw error;
    }
  });
}
