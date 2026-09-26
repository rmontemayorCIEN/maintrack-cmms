import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseDate, sinCostos, withAuth, withVista } from "@/lib/api";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";
import { avisarNuevaOrden } from "@/lib/avisos/ordenes";
import { avisarGarantiaEnOrden } from "@/lib/avisos/vigencias";
import { advertenciaDeGarantia } from "@/lib/vigencias";
import { OPEN_STATUSES } from "@/lib/constants";
import { revisarProgramacion, validarDatosDeProgramacion } from "@/lib/programacion";
import { enFila, hace } from "@/lib/repeticion";

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
  aceptarAdvertencias: z.boolean().optional(),
  tasks: z.array(z.object({ title: z.string().min(1), taskType: z.string().default("CHECK"), required: z.boolean().default(true) })).optional(),
});

export async function GET(request: Request) {
  return withVista("/work-orders", async ({ orgId, user }) => {
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
    return ok({ workOrders: sinCostos(workOrders, user.role) });
  });
}

export async function POST(request: Request) {
  return withAuth("workorder:write", async ({ user, orgId }) => {
    const input = createSchema.parse(await request.json());
    const asset = input.assetId
      ? await prisma.asset.findFirst({ where: { id: input.assetId, organizationId: orgId } })
      : null;

    // Responsable y cuadrilla de la misma empresa: un id ajeno no puede entrar.
    if (input.assignedToId) {
      const existe = await prisma.user.count({ where: { id: input.assignedToId, organizationId: orgId, active: true, role: { in: ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"] } } });
      if (!existe) return fail("El responsable indicado no existe, está inactivo o su rol no ejecuta órdenes", 404);
    }
    if (input.teamId) {
      const existe = await prisma.team.count({ where: { id: input.teamId, organizationId: orgId } });
      if (!existe) return fail("La cuadrilla indicada no existe", 404);
    }
    if (input.locationId) {
      const existe = await prisma.location.count({ where: { id: input.locationId, organizationId: orgId } });
      if (!existe) return fail("La ubicación indicada no existe", 404);
    }
    const dueDate = parseDate(input.dueDate);
    validarDatosDeProgramacion({ estimatedHours: input.estimatedHours, dueDate, scheduledStart: parseDate(input.scheduledStart) });
    /**
     * La garantia se revisa SIEMPRE, y aparte de la programacion.
     *
     * `revisarProgramacion` se sale de inmediato cuando no hay fecha de
     * vencimiento (`if (!p.fecha) return vacio`), y una correctiva urgente se
     * abre sin fecha justo cuando el equipo acaba de fallar. Metida ahi, la
     * advertencia se habria perdido exactamente en el caso que importa.
     */
    const garantia = await advertenciaDeGarantia(orgId, input.assetId, input.maintenanceType);
    if (!input.aceptarAdvertencias) {
      const revision = await revisarProgramacion({
        organizationId: orgId, fecha: dueDate, responsableId: input.assignedToId || null, horas: input.estimatedHours,
      });
      const advertencias = [...(garantia ? [garantia.texto] : []), ...revision.advertencias];
      if (advertencias.length) return fail(advertencias.join(" "), 409, { programacion: revision, garantia });
    }

    // Un doble toque, un reintento del navegador o una segunda pestana no
    // pueden levantar dos ordenes para el mismo trabajo. El `disabled` del
    // boton no sobrevive a una red lenta; esto si (lib/repeticion.ts).
    return enFila(`ot:${user.id}:${input.title.trim().toLowerCase()}:${input.assetId ?? ""}`, async () => {
    const repetida = await prisma.workOrder.findFirst({
      where: {
        organizationId: orgId, createdById: user.id, title: input.title,
        assetId: input.assetId || null, createdAt: { gte: hace() },
      },
      select: { number: true },
    });
    if (repetida) return fail(`Esa orden ya se creó hace un momento (${repetida.number}). No se creó otra.`, 409);

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

    // Aviso al responsable y, si es crítica, a supervisión.
    await avisarNuevaOrden(orgId, workOrder.id);

    /**
     * Y si el equipo está en garantía, que lo sepa quien va a hacer el
     * trabajo. La advertencia de arriba la vio quien la creó —y pudo
     * aceptarla—; el aviso es para el que llega con la llave en la mano.
     */
    if (garantia) await avisarGarantiaEnOrden(orgId, workOrder.id, garantia);

    return ok({ workOrder }, 201);
    });
  });
}
