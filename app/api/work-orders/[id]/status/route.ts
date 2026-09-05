import { z } from "zod";
import { ok, withAuth } from "@/lib/api";
import { transitionWorkOrder } from "@/lib/workorders";

const schema = z.object({
  status: z.enum(["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"]),
  resolution: z.string().optional(),
  /**
   * Una falla por actividad correctiva de la orden.
   *
   * taskId en null significa el encabezado, para las ordenes viejas que no
   * tienen actividades donde colgar el codigo.
   */
  fallas: z.array(z.object({
    taskId: z.string().nullable(),
    failureCodeId: z.string().nullable(),
    rootCauseId: z.string().nullable(),
    downtimeMinutes: z.coerce.number().min(0),
  })).optional(),
  // Se conservan por compatibilidad: hay clientes de API y pruebas que aun
  // cierran mandando un solo codigo arriba.
  rootCauseId: z.string().nullable().optional(),
  failureCodeId: z.string().nullable().optional(),
  downtimeMinutes: z.coerce.number().min(0).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const workOrder = await transitionWorkOrder({
      workOrderId: id,
      to: input.status,
      userId: user.id,
      organizationId: orgId,
      resolution: input.resolution,
      fallas: input.fallas,
      rootCauseId: input.rootCauseId,
      failureCodeId: input.failureCodeId,
      downtimeMinutes: input.downtimeMinutes,
    });
    return ok({ workOrder });
  });
}
