import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { reconocerAviso } from "@/lib/avisos/emitir";
import { enFila } from "@/lib/repeticion";

/**
 * «Aceptar»: el responsable dice que ya vio la orden y la toma. No la inicia
 * (eso es «Iniciar», con su hora real): queda en la bitácora y reconoce sus
 * avisos de asignación, lo que detiene el recordatorio de «sin aceptar».
 * Aceptar dos veces no repite nada.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    return enFila(`aceptar:${user.id}:${id}`, async () => {
      const wo = await prisma.workOrder.findFirst({ where: { id, organizationId: orgId }, select: { id: true, number: true, status: true, assignedToId: true, startedAt: true } });
      if (!wo) return fail("Orden de trabajo no encontrada", 404);
      if (wo.assignedToId !== user.id) return fail("Solo quien la tiene asignada puede aceptarla.", 403);
      if (!["OPEN", "ASSIGNED"].includes(wo.status) || wo.startedAt) return fail("La orden ya está en curso o terminada: no hay nada que aceptar.", 409);
      const ya = await prisma.auditLog.findFirst({ where: { organizationId: orgId, entity: "WorkOrder", entityId: wo.id, action: "ACCEPTED", userId: user.id } });
      if (ya) return ok({ aceptada: true, yaEstaba: true });
      await prisma.workOrderComment.create({ data: { workOrderId: wo.id, userId: user.id, body: "Aceptó la orden." } });
      await logAudit({ organizationId: orgId, userId: user.id, entity: "WorkOrder", entityId: wo.id, action: "ACCEPTED", summary: `${wo.number} aceptada por ${user.name}` });
      const avisos = await prisma.notification.findMany({
        where: { organizationId: orgId, userId: user.id, entidadId: wo.id, tipo: { in: ["OT_ASIGNADA", "OT_SIN_ACEPTAR"] } }, select: { id: true },
      });
      for (const a of avisos) await reconocerAviso({ organizationId: orgId, userId: user.id, notificationId: a.id });
      return ok({ aceptada: true }, 201);
    });
  });
}
