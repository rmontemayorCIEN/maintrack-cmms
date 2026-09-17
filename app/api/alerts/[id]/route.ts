import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  action: z.enum(["ACKNOWLEDGE", "DISMISS", "RESOLVE", "CREATE_WORK_ORDER", "VALIDATE_NORMALIZATION"]),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("predictive:write", async ({ user, orgId }) => {
    const alert = await prisma.predictiveAlert.findFirst({
      where: { id, organizationId: orgId },
      include: { asset: true, sensor: true },
    });
    if (!alert) return fail("Alerta no encontrada", 404);

    const input = schema.parse(await request.json());

    if (input.action === "CREATE_WORK_ORDER") {
      if (alert.workOrderId) return fail("La alerta ya tiene una OT asociada", 409);
      const number = await nextWorkOrderNumber(orgId);
      const workOrder = await prisma.workOrder.create({
        data: {
          organizationId: orgId,
          number,
          title: `Intervencion predictiva: ${alert.asset.name}`,
          description: alert.message,
          maintenanceType: "PREDICTIVE",
          status: "OPEN",
          priority: alert.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
          assetId: alert.assetId,
          siteId: alert.asset.siteId,
          locationId: alert.asset.locationId,
          // El cruce critico solo si todavia es futuro: una fecha pasada crearia
          // una orden que nace vencida por una proyeccion que ya no aplica.
          dueDate:
            alert.fechaCruceCritico && alert.fechaCruceCritico > new Date()
              ? alert.fechaCruceCritico
              : new Date(Date.now() + 7 * 86_400_000),
          estimatedHours: 3,
          createdById: user.id,
        },
      });
      await prisma.predictiveAlert.update({
        where: { id },
        data: { workOrderId: workOrder.id, status: "ACKNOWLEDGED", acknowledgedById: user.id, acknowledgedAt: new Date() },
      });
      return ok({ workOrder }, 201);
    }

    /**
     * Validar la normalizacion: el punto regreso a normal y alguien confirma
     * que es real (no un sensor desconectado ni una lectura suelta). Solo
     * procede si el sistema detecto la normalizacion.
     */
    if (input.action === "VALIDATE_NORMALIZATION") {
      if (!alert.normalizadaEl) return fail("El punto no ha regresado a valores normales", 409);
      const updated = await prisma.predictiveAlert.update({
        where: { id },
        data: { status: "RESOLVED", acknowledgedById: user.id, acknowledgedAt: new Date() },
      });
      await logAudit({
        organizationId: orgId,
        userId: user.id,
        entity: "PredictiveAlert",
        entityId: id,
        action: "NORMALIZACION_VALIDADA",
        summary: `${alert.title}: normalización validada (normal desde ${alert.normalizadaEl.toISOString()})`,
      });
      return ok({ alert: updated });
    }

    const statusMap = {
      ACKNOWLEDGE: "ACKNOWLEDGED",
      DISMISS: "DISMISSED",
      RESOLVE: "RESOLVED",
    } as const;

    const updated = await prisma.predictiveAlert.update({
      where: { id },
      data: {
        status: statusMap[input.action as keyof typeof statusMap],
        acknowledgedById: user.id,
        acknowledgedAt: new Date(),
      },
    });
    return ok({ alert: updated });
  });
}
