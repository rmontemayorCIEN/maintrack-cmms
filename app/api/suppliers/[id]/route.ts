import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

const editar = z.object({
  name: z.string().trim().min(2).max(140).optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  email: z.union([z.string().trim().email(), z.literal("")]).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("settings:write", async ({ user, orgId }) => {
    const existe = await prisma.supplier.findFirst({ where: { id, organizationId: orgId }, select: { id: true } });
    if (!existe) return fail("Proveedor no encontrado", 404);

    const datos = editar.parse(await request.json());

    await prisma.supplier.updateMany({
      where: { id, organizationId: orgId },
      data: { ...datos, ...(datos.email !== undefined ? { email: datos.email || null } : {}) },
    });

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Supplier", entityId: id, action: "UPDATED",
      summary: `Proveedor actualizado: ${datos.name ?? ""}`.trim(),
    });

    return ok({ success: true });
  });
}

/**
 * Lo que impide borrar un proveedor.
 *
 * Igual que con los activos: no es integridad referencial sino historia. Una
 * refaccion apunta a quien la surte y una OT guarda a quien se le pago el
 * servicio. Borrar al proveedor deja esos registros sin dueño y con ellos se
 * pierde el rastro de a quien se le compro.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("settings:write", async ({ user, orgId }) => {
    const proveedor = await prisma.supplier.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true, _count: { select: { parts: true, services: true, workOrderServices: true } } },
    });
    if (!proveedor) return fail("Proveedor no encontrado", 404);

    const atado = [
      proveedor._count.parts ? `${proveedor._count.parts} ${proveedor._count.parts === 1 ? "refaccion" : "refacciones"}` : null,
      proveedor._count.services ? `${proveedor._count.services} ${proveedor._count.services === 1 ? "servicio" : "servicios"} en catalogo` : null,
      proveedor._count.workOrderServices ? `${proveedor._count.workOrderServices} ${proveedor._count.workOrderServices === 1 ? "servicio prestado" : "servicios prestados"}` : null,
    ].filter(Boolean) as string[];

    if (atado.length) {
      return fail(
        `No se puede borrar ${proveedor.name}: tiene ${atado.join(", ")}. ` +
          `Ese es el rastro de a quien se le compro. Reasigne lo que le cuelga antes de borrarlo.`,
        409,
      );
    }

    await prisma.supplier.delete({ where: { id } });
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Supplier", entityId: id, action: "DELETED",
      summary: `Proveedor eliminado: ${proveedor.name}`,
    });
    return ok({ success: true });
  });
}
