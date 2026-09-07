import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().trim().min(2).optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  unit: z.string().min(1).optional(),
  unitCost: z.coerce.number().min(0).optional(),
  minQuantity: z.coerce.number().min(0).optional(),
  maxQuantity: z.coerce.number().min(0).optional(),
  bin: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

/**
 * Edicion de una refaccion.
 *
 * La existencia NO se toca aqui a proposito: se mueve con entradas, salidas y
 * ajustes, que dejan rastro en el kardex. Permitir sobrescribirla desde un
 * formulario destruiria la trazabilidad del inventario.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const previa = await prisma.part.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, code: true, name: true },
    });
    if (!previa) return fail("Refacción no encontrada", 404);

    const input = schema.parse(await request.json());

    // Familia y unidad son catalogos: se validan igual que en el alta.
    if (input.unit) {
      const u = await prisma.partUnit.findFirst({
        where: { organizationId: orgId, code: input.unit }, select: { id: true },
      });
      if (!u) return fail(`La unidad "${input.unit}" no esta en el catalogo`, 422);
    }
    if (input.category) {
      const c = await prisma.partCategory.findFirst({
        where: { organizationId: orgId, code: input.category }, select: { id: true },
      });
      if (!c) return fail(`La familia "${input.category}" no esta en el catalogo`, 422);
    }

    const part = await prisma.part.update({
      where: { id },
      data: { ...input, supplierId: input.supplierId || null },
    });

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Part", entityId: id,
      action: "UPDATED", summary: `${previa.code} actualizada`, changes: input,
    });

    return ok({ part });
  });
}
