import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { logAudit, notify } from "@/lib/audit";

const schema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reviewNotes: z.string().optional(),
  assignedToId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

/** Aprobar una solicitud la convierte en orden de trabajo correctiva. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("request:review", async ({ user, orgId }) => {
    const workRequest = await prisma.workRequest.findFirst({
      where: { id, organizationId: orgId },
      include: { asset: true },
    });
    if (!workRequest) return fail("Solicitud no encontrada", 404);
    if (workRequest.status !== "PENDING") return fail("La solicitud ya fue revisada", 409);

    const input = schema.parse(await request.json());

    if (input.action === "REJECT") {
      const updated = await prisma.workRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewedById: user.id,
          reviewedAt: new Date(),
          reviewNotes: input.reviewNotes,
        },
      });
      if (workRequest.requestedById) {
        await notify({
          organizationId: orgId,
          userId: workRequest.requestedById,
          title: `Solicitud ${workRequest.number} rechazada`,
          body: input.reviewNotes ?? undefined,
          link: "/requests",
          kind: "WARNING",
        });
      }
      return ok({ request: updated });
    }

    const number = await nextWorkOrderNumber(orgId);
    const workOrder = await prisma.workOrder.create({
      data: {
        organizationId: orgId,
        number,
        title: workRequest.title,
        description: workRequest.description,
        maintenanceType: "CORRECTIVE",
        status: input.assignedToId ? "ASSIGNED" : "OPEN",
        priority: workRequest.priority,
        assetId: workRequest.assetId,
        siteId: workRequest.siteId,
        locationId: workRequest.locationId,
        assignedToId: input.assignedToId || null,
        createdById: user.id,
        dueDate: input.dueDate ? new Date(input.dueDate) : new Date(Date.now() + 3 * 86_400_000),
        estimatedHours: 2,
      },
    });

    const updated = await prisma.workRequest.update({
      where: { id },
      data: {
        status: "CONVERTED",
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNotes: input.reviewNotes,
        workOrderId: workOrder.id,
      },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "WorkRequest",
      entityId: id,
      action: "CONVERTED",
      summary: `${workRequest.number} → ${number}`,
    });

    if (workRequest.requestedById) {
      await notify({
        organizationId: orgId,
        userId: workRequest.requestedById,
        title: `Solicitud ${workRequest.number} aprobada`,
        body: `Se genero la orden ${number}`,
        link: `/work-orders/${workOrder.id}`,
        kind: "SUCCESS",
      });
    }

    return ok({ request: updated, workOrder }, 201);
  });
}
