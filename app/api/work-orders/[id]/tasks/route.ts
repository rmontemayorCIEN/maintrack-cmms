import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";

const schema = z.object({
  taskId: z.string(),
  done: z.boolean().optional(),
  resultText: z.string().nullable().optional(),
  resultNumber: z.coerce.number().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const task = await prisma.workOrderTask.findFirst({
      where: { id: input.taskId, workOrderId: id, workOrder: { organizationId: orgId } },
    });
    if (!task) return fail("Tarea no encontrada", 404);

    // Una medicion se marca como aprobada si cae dentro del rango esperado.
    let passed: boolean | null = task.passed;
    if (input.resultNumber !== undefined && input.resultNumber !== null) {
      const overMin = task.minValue === null || input.resultNumber >= task.minValue;
      const underMax = task.maxValue === null || input.resultNumber <= task.maxValue;
      passed = overMin && underMax;
    }

    const updated = await prisma.workOrderTask.update({
      where: { id: task.id },
      data: {
        done: input.done ?? task.done,
        resultText: input.resultText ?? task.resultText,
        resultNumber: input.resultNumber ?? task.resultNumber,
        passed,
        completedById: input.done ? user.id : task.completedById,
        completedAt: input.done ? new Date() : task.completedAt,
      },
    });
    return ok({ task: updated });
  });
}

const createSchema = z.object({
  title: z.string().min(1),
  taskType: z.string().default("CHECK"),
  required: z.boolean().default(true),
  unit: z.string().optional(),
  minValue: z.coerce.number().optional(),
  maxValue: z.coerce.number().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:write", async ({ orgId }) => {
    const wo = await prisma.workOrder.findFirst({ where: { id, organizationId: orgId } });
    if (!wo) return fail("Orden de trabajo no encontrada", 404);
    const input = createSchema.parse(await request.json());
    const count = await prisma.workOrderTask.count({ where: { workOrderId: id } });
    const task = await prisma.workOrderTask.create({
      data: { workOrderId: id, position: count, ...input },
    });
    return ok({ task }, 201);
  });
}
