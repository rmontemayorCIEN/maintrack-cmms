import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { nextWorkOrderNumber } from "@/lib/numbering";

const schema = z.object({
  action: z.enum(["ACKNOWLEDGE", "DISMISS", "RESOLVE", "CREATE_WORK_ORDER"]),
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
          dueDate: alert.projectedFailureAt ?? new Date(Date.now() + 7 * 86_400_000),
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
