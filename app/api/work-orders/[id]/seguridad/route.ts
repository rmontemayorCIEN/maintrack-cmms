import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { huellaDeSeguridad, tieneSeguridad } from "@/lib/seguridad-ot";

/**
 * Registra que alguien leyo el procedimiento y las indicaciones de seguridad.
 *
 * Se guarda QUIEN, CUANDO y la huella del texto leido: si despues se edita,
 * la confirmacion deja de valer y hay que volver a hacerla. Queda ademas en
 * la bitacora de la orden, que es el registro que se audita.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ orgId, user }) => {
    const wo = await prisma.workOrder.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, number: true, procedure: true, safetyNotes: true },
    });
    if (!wo) return fail("Orden de trabajo no encontrada", 404);
    if (!tieneSeguridad(wo)) {
      return fail("Esta orden no tiene procedimiento ni indicaciones de seguridad que confirmar", 422);
    }

    await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        seguridadLeidaPorId: user.id,
        seguridadLeidaEl: new Date(),
        seguridadLeidaHuella: huellaDeSeguridad(wo),
      },
    });

    /*
     * Queda en el historial de estados de la orden, que es lo que se revisa
     * cuando hay que explicar algo. NO se manda aviso a la campana: nadie
     * necesita enterarse de que un tecnico leyo su procedimiento, y un aviso
     * que no pide nada solo entrena a la gente a ignorar los que si importan.
     */
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "WorkOrder", entityId: wo.id, action: "UPDATED",
      summary: `Confirmó haber leído el procedimiento y las indicaciones de seguridad de ${wo.number}`,
    });

    return ok({ confirmado: true });
  });
}
