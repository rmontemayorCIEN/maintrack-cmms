import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { actividadValida, asegurarEditable, recalcWorkOrder } from "@/lib/workorders";

const schema = z.object({
  userId: z.string().optional(),
  // Una captura es una jornada de una persona: mas de 24 h en un renglon es
  // un error de dedo (240 por 2.40) que infla costo y productividad.
  hours: z.coerce.number().positive().max(24, "registre las horas por jornada: no más de 24 en un renglón"),
  notes: z.string().optional(),
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
    asegurarEditable(wo);

    const input = schema.parse(await request.json());
    const technicianId = input.userId ?? user.id;
    const technician = await prisma.user.findFirst({
      where: { id: technicianId, organizationId: orgId, active: true },
    });
    if (!technician) return fail("Técnico no encontrado", 404);

    await prisma.workOrderLabor.create({
      data: {
        workOrderId: id,
        userId: technician.id,
        hours: input.hours,
        rate: technician.hourlyRate,
        cost: input.hours * technician.hourlyRate,
        notes: input.notes,
        taskId: await actividadValida(id, input.taskId),
      },
    });

    const workOrder = await recalcWorkOrder(id);
    return ok({ workOrder }, 201);
  });
}
