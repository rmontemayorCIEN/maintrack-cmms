import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { actividadValida, consumePart, quitarRefaccion } from "@/lib/workorders";

const schema = z.object({
  partId: z.string(),
  quantity: z.coerce.number().positive(),
  /**
   * A que actividad se le carga. Opcional: los gastos generales de la orden
   * —el viaje, la grua— no son de ninguna actividad en particular.
   */
  taskId: z.string().optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const workOrder = await consumePart({
      organizationId: orgId,
      workOrderId: id,
      taskId: await actividadValida(id, input.taskId),
      partId: input.partId,
      quantity: input.quantity,
      userId: user.id,
    });
    return ok({ workOrder }, 201);
  });
}

/**
 * Quita una refaccion de la orden. NO borra el movimiento de almacen: genera
 * una devolucion que lo compensa, para que el kardex siga contando la verdad.
 *
 * Pide `inventory:write` igual que cargarla: quien puede sacar del almacen es
 * quien puede regresar.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const lineaId = new URL(request.url).searchParams.get("linea");
    if (!lineaId) return fail("Falta la refacción a quitar", 422);
    const workOrder = await quitarRefaccion({ organizationId: orgId, workOrderId: id, lineaId, userId: user.id });
    return ok({ workOrder });
  });
}
