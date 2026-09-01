import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeConteo, abrirConteo } from "@/lib/conteos";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  warehouseId: z.string().min(1),
  familia: z.string().trim().max(60).optional().nullable(),
  incluirEnCero: z.boolean().default(false),
  nota: z.string().trim().max(300).optional().nullable(),
});

export async function POST(request: Request) {
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    try {
      const c = await abrirConteo({
        organizationId: orgId, warehouseId: input.warehouseId, userId: user.id,
        familia: input.familia, incluirEnCero: input.incluirEnCero, nota: input.nota,
      });
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "InventoryCount", entityId: c.id, action: "OPENED",
        summary: `Conteo ${c.folio} abierto`,
      });
      return ok({ id: c.id, folio: c.folio }, 201);
    } catch (error) {
      if (error instanceof ErrorDeConteo) return fail(error.message, 422);
      throw error;
    }
  });
}
