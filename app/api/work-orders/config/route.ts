import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  otMultiOrigen: z.boolean().optional(),
  recalculoPlan: z.enum(["CIERRE", "PROGRAMADO"]).optional(),
  /**
   * Tope alto a proposito: adelantar un preventivo que vence en tres meses casi
   * nunca conviene —se gasta el mantenimiento antes de tiempo— pero hay plantas
   * que paran una vez al ano y ahi si tiene sentido juntarlo todo.
   */
  otHorizonteDias: z.coerce.number().int().min(0).max(365).optional(),
});

/** Como se arman las ordenes de trabajo en esta organizacion. */
export async function PATCH(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const datos = schema.parse(await request.json());

    const actualizacion: Record<string, unknown> = {};
    if (datos.otMultiOrigen !== undefined) actualizacion.otMultiOrigen = datos.otMultiOrigen;
    if (datos.recalculoPlan !== undefined) actualizacion.recalculoPlan = datos.recalculoPlan;
    if (datos.otHorizonteDias !== undefined) actualizacion.otHorizonteDias = datos.otHorizonteDias;

    if (!Object.keys(actualizacion).length) return ok({ sinCambios: true });

    const org = await prisma.organization.update({
      where: { id: orgId },
      data: actualizacion,
      select: { otMultiOrigen: true, otHorizonteDias: true },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Organization",
      entityId: orgId,
      action: "UPDATED",
      summary: `Ordenes: ${
        datos.otMultiOrigen !== undefined
          ? `varios origenes ${datos.otMultiOrigen ? "encendido" : "apagado"}`
          : "sin cambio"
      }, horizonte ${datos.otHorizonteDias ?? "sin cambio"} dias`,
    });

    return ok({ organizacion: org });
  });
}
