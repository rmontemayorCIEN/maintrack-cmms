import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseDate, withAuth } from "@/lib/api";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { logAudit, notify } from "@/lib/audit";
import { OPEN_STATUSES } from "@/lib/constants";

const createSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional().nullable(),
  maintenanceType: z.enum(["PREVENTIVE", "CORRECTIVE", "PREDICTIVE", "INSPECTION", "SAFETY", "IMPROVEMENT"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  assetId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  scheduledStart: z.string().optional().nullable(),
  estimatedHours: z.coerce.number().min(0).default(1),
  requiresShutdown: z.coerce.boolean().default(false),
  procedure: z.string().optional().nullable(),
  safetyNotes: z.string().optional().nullable(),
  tasks: z.array(z.object({ title: z.string().min(1), taskType: z.string().default("CHECK"), required: z.boolean().default(true) })).optional(),
});

export async function GET(request: Request) {
  return withAuth(null, async ({ orgId }) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    const assetId = url.searchParams.get("assetId");
    const assignedToId = url.searchParams.get("assignedToId");
    const scope = url.searchParams.get("scope");
    const take = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

    const workOrders = await prisma.workOrder.findMany({
      where: {
        organizationId: orgId,
        ...(status ? { status } : {}),
        ...(scope === "open" ? { status: { in: OPEN_STATUSES } } : {}),
        ...(type ? { maintenanceType: type } : {}),
        ...(assetId ? { assetId } : {}),
        ...(assignedToId ? { assignedToId } : {}),
      },
      include: {
        asset: { select: { id: true, code: true, name: true } },
        assignedTo: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take,
    });
    return ok({ workOrders });
  });
}

export async function POST(request: Request) {
  return withAuth("workorder:write", async ({ user, orgId }) => {
    const input = createSchema.parse(await request.json());
    const asset = input.assetId
      ? await prisma.asset.findFirst({ where: { id: input.assetId, organizationId: orgId } })
      : null;

    const number = await nextWorkOrderNumber(orgId);
    const workOrder = await prisma.workOrder.create({
      data: {
        organizationId: orgId,
        number,
        title: input.title,
        description: input.description,
        maintenanceType: input.maintenanceType,
        status: input.assignedToId ? "ASSIGNED" : "OPEN",
        priority: input.priority,
        assetId: asset?.id ?? null,
        siteId: asset?.siteId ?? null,
        locationId: input.locationId ?? asset?.locationId ?? null,
        assignedToId: input.assignedToId || null,
        teamId: input.teamId || null,
        createdById: user.id,
        dueDate: parseDate(input.dueDate),
        scheduledStart: parseDate(input.scheduledStart),
        estimatedHours: input.estimatedHours,
        requiresShutdown: input.requiresShutdown,
        procedure: input.procedure,
        safetyNotes: input.safetyNotes,
        tasks: input.tasks?.length
          ? {
              create: input.tasks.map((task, index) => ({
                position: index,
                title: task.title,
                taskType: task.taskType,
                required: task.required,
                origen: "MANUAL",
                maintenanceType: input.maintenanceType,
              })),
            }
          : undefined,
      },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "WorkOrder",
      entityId: workOrder.id,
      action: "CREATED",
      summary: `${number} — ${input.title}`,
    });

    if (input.assignedToId) {
      await notify({
        organizationId: orgId,
        userId: input.assignedToId,
        title: `OT asignada ${number}`,
        body: input.title,
        link: `/work-orders/${workOrder.id}`,
        tag: number,
      });
    }

    return ok({ workOrder }, 201);
  });
}
