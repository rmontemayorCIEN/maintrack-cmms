import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { logAudit, notify } from "@/lib/audit";
import { tipoDeTrabajo } from "@/lib/tipos-solicitud";

const schema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reviewNotes: z.string().optional(),
  assignedToId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  /**
   * OT existente a la que se suma el reporte, en vez de abrir una nueva.
   *
   * Es el caso real: el tecnico ya va a esa bomba por el preventivo del mes,
   * asi que la fuga reportada se atiende en el mismo viaje. El reporte entra
   * como una actividad mas, con su propio tipo, no como orden aparte.
   */
  workOrderId: z.string().optional().nullable(),
  /** Como lo clasifico quien reviso: FALLA | MEJORA | APOYO | OTRO. */
  tipo: z.enum(["FALLA", "MEJORA", "APOYO", "OTRO"]).optional(),
});

/** Aprobar una solicitud la convierte en orden de trabajo correctiva. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("request:review", async ({ user, orgId }) => {
    const workRequest = await prisma.workRequest.findFirst({
      where: { id, organizationId: orgId },
      include: { asset: true },
    });
    if (!workRequest) return fail("Solicitud no encontrada", 404);
    if (workRequest.status !== "PENDING") return fail("La solicitud ya fue revisada", 409);

    const input = schema.parse(await request.json());

    if (input.action === "REJECT") {
      const updated = await prisma.workRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNotes: input.reviewNotes,
        },
      });
      if (workRequest.requestedById) {
        await notify({
          organizationId: orgId,
          userId: workRequest.requestedById,
          title: `Solicitud ${workRequest.number} rechazada`,
          body: input.reviewNotes ?? undefined,
          link: "/requests",
          kind: "WARNING",
        });
      }
      return ok({ request: updated });
    }

    /**
     * El reporte se atiende como ACTIVIDAD, no como encabezado.
     *
     * Antes la conversion creaba una OT vacia, sin una sola actividad, y el
     * codigo de falla se capturaba arriba. Eso impedia que una misma orden
     * atendiera dos reportes: un encabezado no puede tener dos causas. Ahora
     * cada reporte entra como su propia actividad, con su origen y su tipo, y
     * al cerrar se le pregunta su causa por separado.
     */
    let workOrder: { id: string; number: string };

    if (input.workOrderId) {
      const destino = await prisma.workOrder.findFirst({
        where: { id: input.workOrderId, organizationId: orgId },
        select: { id: true, number: true, status: true, assetId: true },
      });
      if (!destino) return fail("La orden de trabajo no existe", 404);
      if (["COMPLETED", "CANCELLED"].includes(destino.status)) {
        return fail("Esa orden ya esta cerrada. Elija otra o abra una nueva.", 409);
      }
      // Sumar a una orden de otro equipo mezclaria el historial de dos activos.
      if (workRequest.assetId && destino.assetId && workRequest.assetId !== destino.assetId) {
        return fail("La orden es de otro equipo. El reporte debe ir a una orden del mismo activo.", 409);
      }
      workOrder = destino;
    } else {
      const number = await nextWorkOrderNumber(orgId);
      workOrder = await prisma.workOrder.create({
        data: {
          organizationId: orgId,
          number,
          title: workRequest.title,
          description: workRequest.description,
          // Del tipo de la solicitud, no a fuego: una mejora o un apoyo no
          // deben entrar como falla y ensuciar el Pareto.
          maintenanceType: tipoDeTrabajo(input.tipo ?? workRequest.tipo),
          status: input.assignedToId ? "ASSIGNED" : "OPEN",
          priority: workRequest.priority,
          assetId: workRequest.assetId,
          siteId: workRequest.siteId,
          locationId: workRequest.locationId,
          assignedToId: input.assignedToId || null,
          createdById: user.id,
          dueDate: input.dueDate ? new Date(input.dueDate) : new Date(Date.now() + 3 * 86_400_000),
          estimatedHours: 2,
        },
        select: { id: true, number: true },
      });
    }

    const ultima = await prisma.workOrderTask.aggregate({
      where: { workOrderId: workOrder.id },
      _max: { position: true },
    });
    await prisma.workOrderTask.create({
      data: {
        workOrderId: workOrder.id,
        position: (ultima._max.position ?? -1) + 1,
        origen: "SOLICITUD",
        origenRequestId: workRequest.id,
        maintenanceType: tipoDeTrabajo(input.tipo ?? workRequest.tipo),
        title: workRequest.title,
        description: workRequest.description,
        taskType: "CHECK",
        required: true,
      },
    });

    const number = workOrder.number;

    const updated = await prisma.workRequest.update({
      where: { id },
      data: {
        status: "CONVERTED",
        tipo: input.tipo ?? workRequest.tipo,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNotes: input.reviewNotes,
        workOrderId: workOrder.id,
      },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "WorkRequest",
      entityId: id,
      action: "CONVERTED",
      summary: `${workRequest.number} → ${number}`,
    });

    if (workRequest.requestedById) {
      await notify({
        organizationId: orgId,
        userId: workRequest.requestedById,
        title: `Solicitud ${workRequest.number} aprobada`,
        body: `Se genero la orden ${number}`,
        link: `/work-orders/${workOrder.id}`,
        kind: "SUCCESS",
      });
    }

    return ok({ request: updated, workOrder }, 201);
  });
}
