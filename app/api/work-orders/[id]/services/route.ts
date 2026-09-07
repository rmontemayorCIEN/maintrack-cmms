import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { recalcWorkOrder } from "@/lib/workorders";
import { logAudit } from "@/lib/audit";
import { actividadValida } from "@/lib/workorders";

/**
 * Servicios subcontratados de una orden de trabajo.
 *
 * A diferencia de una refaccion, un servicio no descuenta del almacen: es un
 * gasto que se contrata afuera. Puede venir del catalogo o capturarse suelto,
 * porque no todo trabajo puntual amerita darse de alta como servicio.
 */
const schema = z.object({
  serviceId: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  descripcion: z.string().trim().min(3).max(300).optional().nullable(),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  folioProveedor: z.string().trim().max(60).optional().nullable(),
  nota: z.string().trim().max(300).optional().nullable(),
  /**
   * A que actividad se le carga. Opcional: los gastos generales de la orden
   * —el viaje, la grua— no son de ninguna actividad en particular.
   */
  taskId: z.string().optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const wo = await prisma.workOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!wo) return fail("Orden de trabajo no encontrada", 404);
    if (["CLOSED", "CANCELLED"].includes(wo.status)) {
      return fail("La orden ya esta cerrada: sus costos no se modifican", 409);
    }

    const input = schema.parse(await request.json());

    let descripcion = input.descripcion?.trim() ?? "";
    let supplierId = input.supplierId || null;

    if (input.serviceId) {
      const servicio = await prisma.externalService.findFirst({
        where: { id: input.serviceId, organizationId: orgId },
      });
      if (!servicio) return fail("Servicio externo no encontrado", 404);
      if (!descripcion) descripcion = `${servicio.code} — ${servicio.name}`;
      if (!supplierId) supplierId = servicio.supplierId;
    }
    if (!descripcion) return fail("Indique que servicio se contrato", 422);

    if (supplierId) {
      const proveedor = await prisma.supplier.count({ where: { id: supplierId, organizationId: orgId } });
      if (!proveedor) return fail("Proveedor no encontrado", 404);
    }

    await prisma.workOrderService.create({
      data: {
        workOrderId: id,
        serviceId: input.serviceId || null,
        supplierId,
        descripcion,
        quantity: input.quantity,
        unitCost: input.unitCost,
        cost: input.quantity * input.unitCost,
        folioProveedor: input.folioProveedor || null,
        nota: input.nota || null,
        taskId: await actividadValida(id, input.taskId),
      },
    });

    const workOrder = await recalcWorkOrder(id);
    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "WorkOrder",
      entityId: id,
      action: "UPDATED",
      summary: `${wo.number}: servicio externo ${descripcion}`,
    });
    return ok({ workOrder }, 201);
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ orgId }) => {
    const lineaId = new URL(request.url).searchParams.get("linea");
    if (!lineaId) return fail("Falta la línea a eliminar", 422);

    const wo = await prisma.workOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!wo) return fail("Orden de trabajo no encontrada", 404);
    if (["CLOSED", "CANCELLED"].includes(wo.status)) {
      return fail("La orden ya esta cerrada: sus costos no se modifican", 409);
    }

    const borradas = await prisma.workOrderService.deleteMany({ where: { id: lineaId, workOrderId: id } });
    if (!borradas.count) return fail("Línea no encontrada", 404);

    const workOrder = await recalcWorkOrder(id);
    return ok({ workOrder });
  });
}
