import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { actividadValida, asegurarEditable, quitarHoras, recalcWorkOrder } from "@/lib/workorders";
import { can } from "@/lib/rbac";
import { enFila, hace } from "@/lib/repeticion";

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

    // El doble toque no registra la jornada dos veces (lib/repeticion.ts).
    return enFila(`horas:${technician.id}:${id}:${input.hours}`, async () => {
    const repetido = await prisma.workOrderLabor.count({
      where: { workOrderId: id, userId: technician.id, hours: input.hours, workedAt: { gte: hace() } },
    });
    if (repetido) return fail("Esas horas ya se registraron hace un momento. No se volvieron a sumar.", 409);

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
  });
}

/**
 * Quita un registro de horas.
 *
 * El tecnico puede quitar las suyas —se equivoco al capturar— y quien
 * supervisa, cualquiera: es quien valida el trabajo antes de cerrar.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const lineaId = new URL(request.url).searchParams.get("linea");
    if (!lineaId) return fail("Falta el registro a quitar", 422);
    const workOrder = await quitarHoras({
      organizationId: orgId, workOrderId: id, lineaId, userId: user.id,
      soloPropias: !can(user.role, "workorder:write"),
    });
    return ok({ workOrder });
  });
}
