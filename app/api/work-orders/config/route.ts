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
  otDiasHabiles: z.boolean().optional(),
  otGeneracion: z.enum(["AUTOMATICA", "MANUAL"]).optional(),
  otEvidenciaCriticas: z.boolean().optional(),
  /**
   * Como identifica ESTA empresa el formato impreso de la orden dentro de su
   * sistema de calidad. Vacio lo quita del pie. Se recorta en vez de
   * rechazarse: un codigo largo es un descuido, no un error que valga la pena
   * pelear con el usuario.
   */
  codigoFormatoOT: z.string().trim().max(40).nullable().optional(),
  revisionFormatoOT: z.string().trim().max(12).nullable().optional(),
});

/** Como se arman las ordenes de trabajo en esta organizacion. */
export async function PATCH(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const datos = schema.parse(await request.json());

    const actualizacion: Record<string, unknown> = {};
    if (datos.otMultiOrigen !== undefined) actualizacion.otMultiOrigen = datos.otMultiOrigen;
    if (datos.recalculoPlan !== undefined) actualizacion.recalculoPlan = datos.recalculoPlan;
    if (datos.otHorizonteDias !== undefined) actualizacion.otHorizonteDias = datos.otHorizonteDias;
    if (datos.otDiasHabiles !== undefined) actualizacion.otDiasHabiles = datos.otDiasHabiles;
    if (datos.otGeneracion !== undefined) actualizacion.otGeneracion = datos.otGeneracion;
    if (datos.otEvidenciaCriticas !== undefined) actualizacion.otEvidenciaCriticas = datos.otEvidenciaCriticas;
    if (datos.codigoFormatoOT !== undefined) actualizacion.codigoFormatoOT = datos.codigoFormatoOT || null;
    if (datos.revisionFormatoOT !== undefined) actualizacion.revisionFormatoOT = datos.revisionFormatoOT || null;

    if (!Object.keys(actualizacion).length) return ok({ sinCambios: true });

    const org = await prisma.organization.update({
      where: { id: orgId },
      data: actualizacion,
      select: { otMultiOrigen: true, otHorizonteDias: true, otDiasHabiles: true, otGeneracion: true },
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
      }, horizonte ${datos.otHorizonteDias ?? "sin cambio"} dias, dias ${
        datos.otDiasHabiles === undefined ? "sin cambio" : datos.otDiasHabiles ? "habiles" : "corridos"
      }, generacion ${datos.otGeneracion ?? "sin cambio"}, evidencia en criticas ${
        datos.otEvidenciaCriticas === undefined ? "sin cambio" : datos.otEvidenciaCriticas ? "encendida" : "apagada"
      }`,
    });

    return ok({ organizacion: org });
  });
}
