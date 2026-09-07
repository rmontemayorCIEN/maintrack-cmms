import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  taskId: z.string(),
  direccion: z.enum(["ARRIBA", "ABAJO"]),
});

/**
 * Mueve una actividad un lugar dentro de la orden.
 *
 * El plan y la IA proponen un orden; quien conoce la planta decide el
 * definitivo. Se mueve de a un lugar y no arrastrando: en una tableta, con
 * guantes y de pie junto a la maquina, arrastrar es una fuente de errores.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const orden = await prisma.workOrder.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, number: true, status: true },
    });
    if (!orden) return fail("Orden de trabajo no encontrada", 404);
    if (["COMPLETED", "CLOSED", "CANCELLED"].includes(orden.status)) {
      return fail("Esa orden ya esta cerrada; su lista no se reordena.", 409);
    }

    const tareas = await prisma.workOrderTask.findMany({
      where: { workOrderId: id },
      orderBy: { position: "asc" },
      select: { id: true, position: true, done: true, liberadaAt: true, title: true },
    });

    const i = tareas.findIndex((t) => t.id === input.taskId);
    if (i < 0) return fail("Esa actividad no es de esta orden", 404);

    const j = input.direccion === "ARRIBA" ? i - 1 : i + 1;
    if (j < 0 || j >= tareas.length) return ok({ sinCambio: true });

    /**
     * No se pasa por encima de lo ya resuelto.
     *
     * Mover una actividad arriba de una que ya se hizo reescribe la historia:
     * la lista diria que se ejecutaron en un orden que no fue. Lo que ya paso
     * se queda donde paso.
     */
    const actual = tareas[i];
    const destino = tareas[j];
    if (actual.done || actual.liberadaAt) {
      return fail("Una actividad ya resuelta se queda en su lugar.", 409);
    }
    if (input.direccion === "ARRIBA" && (destino.done || destino.liberadaAt)) {
      return fail("No se puede mover arriba de una actividad ya resuelta.", 409);
    }

    /**
     * Se intercambian las posiciones, con un valor temporal de por medio.
     *
     * Sin ese paso intermedio, si algun dia `position` lleva restriccion de
     * unicidad, el primer update chocaria con el valor que aun tiene la otra.
     */
    await prisma.$transaction([
      prisma.workOrderTask.update({ where: { id: actual.id }, data: { position: -1 } }),
      prisma.workOrderTask.update({ where: { id: destino.id }, data: { position: actual.position } }),
      prisma.workOrderTask.update({ where: { id: actual.id }, data: { position: destino.position } }),
    ]);

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "WorkOrder",
      entityId: id,
      action: "UPDATED",
      summary: `${orden.number}: se movio "${actual.title.slice(0, 40)}" hacia ${input.direccion.toLowerCase()}`,
    });

    return ok({ movida: true });
  });
}
