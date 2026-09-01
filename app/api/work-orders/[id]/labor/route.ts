import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { recalcWorkOrder } from "@/lib/workorders";

const schema = z.object({
  userId: z.string().optional(),
  hours: z.coerce.number().positive(),
  notes: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const wo = await prisma.workOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!wo) return fail("Orden de trabajo no encontrada", 404);

    const input = schema.parse(await request.json());
    const technicianId = input.userId ?? user.id;
    const technician = await prisma.user.findFirst({
      where: { id: technicianId, organizationId: orgId },
    });
    if (!technician) return fail("Tecnico no encontrado", 404);

    await prisma.workOrderLabor.create({
      data: {
        workOrderId: id,
        userId: technician.id,
        hours: input.hours,
        rate: technician.hourlyRate,
        cost: input.hours * technician.hourlyRate,
        notes: input.notes,
      },
    });

    const workOrder = await recalcWorkOrder(id);
    return ok({ workOrder }, 201);
  });
}
