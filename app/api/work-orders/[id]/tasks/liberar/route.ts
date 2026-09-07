import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { MOTIVOS_LIBERACION, esMotivoValido } from "@/lib/backlog";
import { logAudit } from "@/lib/audit";

/**
 * Libera una actividad de la OT: no se pudo hacer y se devuelve al backlog.
 *
 * La actividad se queda en la orden, marcada, para que esa OT siga contando lo
 * que paso. Lo que cambia es que deja de bloquear el cierre y aparece en el
 * backlog del activo hasta que otra OT la retome.
 */
const schema = z.object({
  taskId: z.string().min(1),
  motivo: z.string().refine(esMotivoValido, {
    message: `Motivo invalido. Use uno de: ${Object.keys(MOTIVOS_LIBERACION).join(", ")}`,
  }),
  detalle: z.string().trim().max(400).nullable().optional(),
  /// Cuando se libera por falta de refaccion, cual. Es lo que despues permite
  /// decir en el backlog que ya hay existencia y el trabajo se puede hacer.
  bloqueadaPorPartId: z.string().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const task = await prisma.workOrderTask.findFirst({
      where: { id: input.taskId, workOrderId: id, workOrder: { organizationId: orgId } },
      select: { id: true, title: true, done: true, liberadaAt: true, workOrder: { select: { number: true, status: true } } },
    });
    if (!task) return fail("Actividad no encontrada", 404);
    if (task.liberadaAt) return fail("Esa actividad ya estaba liberada", 409);
    if (task.done) {
      return fail("Esa actividad ya se marco como hecha. Desmarquela antes de liberarla.", 409);
    }
    if (["CLOSED", "CANCELLED"].includes(task.workOrder.status)) {
      return fail("La orden ya esta cerrada; no se pueden liberar actividades.", 409);
    }

    // La refaccion solo tiene sentido con ese motivo, y debe ser de la misma
    // organizacion: un id de otra empresa no puede entrar por aqui.
    let partId: string | null = null;
    if (input.motivo === "SIN_REFACCION" && input.bloqueadaPorPartId) {
      const part = await prisma.part.findFirst({
        where: { id: input.bloqueadaPorPartId, organizationId: orgId },
        select: { id: true },
      });
      if (!part) return fail("Refacción no encontrada", 404);
      partId = part.id;
    }

    const updated = await prisma.workOrderTask.update({
      where: { id: task.id },
      data: {
        liberadaAt: new Date(),
        liberadaPorId: user.id,
        motivoLiberacion: input.motivo,
        motivoDetalle: input.detalle?.trim() || null,
        bloqueadaPorPartId: partId,
      },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      action: "TASK_RELEASED",
      entity: "WorkOrderTask",
      entityId: task.id,
      summary: `${task.workOrder.number}: se libero «${task.title}» — ${MOTIVOS_LIBERACION[input.motivo]}`,
    });

    return ok({ task: updated });
  });
}

/** Deshace una liberacion, mientras la orden siga abierta. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const { taskId } = z.object({ taskId: z.string().min(1) }).parse(await request.json());

    const task = await prisma.workOrderTask.findFirst({
      where: { id: taskId, workOrderId: id, workOrder: { organizationId: orgId } },
      select: { id: true, liberadaAt: true, retomadaPor: { select: { id: true } }, workOrder: { select: { status: true } } },
    });
    if (!task) return fail("Actividad no encontrada", 404);
    if (!task.liberadaAt) return fail("Esa actividad no estaba liberada", 409);
    if (task.retomadaPor) {
      return fail("Otra orden ya retomo esta actividad; no se puede deshacer aqui.", 409);
    }
    if (["CLOSED", "CANCELLED"].includes(task.workOrder.status)) {
      return fail("La orden ya esta cerrada.", 409);
    }

    const updated = await prisma.workOrderTask.update({
      where: { id: task.id },
      data: {
        liberadaAt: null, liberadaPorId: null,
        motivoLiberacion: null, motivoDetalle: null, bloqueadaPorPartId: null,
      },
    });
    return ok({ task: updated });
  });
}
