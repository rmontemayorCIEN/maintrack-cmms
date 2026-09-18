import { z } from "zod";
import { avisarCambiosDeOrden } from "@/lib/avisos/ordenes";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeAgenda, reprogramar } from "@/lib/agenda";
import { OPEN_STATUSES } from "@/lib/constants";
import { logAudit } from "@/lib/audit";

/** Aplica un movimiento propuesto por la revision de la semana. */
const schema = z.object({
  orden: z.string().min(1),
  aFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use el formato AAAA-MM-DD"),
  aResponsable: z.string().trim().min(1).nullable().optional(),
});

export async function POST(request: Request) {
  return withAuth("workorder:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const antes = await prisma.workOrder.findFirst({
      where: { organizationId: orgId, number: input.orden },
      select: { id: true, dueDate: true, assignedToId: true, priority: true },
    });

    try {
      const resultado = await reprogramar({
        organizationId: orgId,
        numeroOrden: input.orden,
        fecha: input.aFecha,
        responsableNombre: input.aResponsable ?? null,
        estadosAbiertos: OPEN_STATUSES,
      });

      // Si cambió el responsable, al nuevo le llega la asignación y al anterior
      // que ya no es suya. Aquí y no en lib/agenda: ese archivo lo lee también
      // una pantalla del navegador, y los avisos son código de servidor.
      if (antes) await avisarCambiosDeOrden(orgId, antes);

      await logAudit({
        organizationId: orgId,
        userId: user.id,
        entity: "WorkOrder",
        entityId: antes?.id ?? resultado.numero,
        action: "RESCHEDULED",
        summary:
          `${resultado.numero}: ${antes?.dueDate ? antes.dueDate.toISOString().slice(0, 10) : "sin fecha"}` +
          ` → ${input.aFecha}` +
          (input.aResponsable && !resultado.aviso ? `, responsable ${input.aResponsable}` : "") +
          " (propuesta de la revision de la semana)",
      });

      return ok({ orden: resultado.numero, aviso: resultado.aviso });
    } catch (e) {
      if (e instanceof ErrorDeAgenda) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
