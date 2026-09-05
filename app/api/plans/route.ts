import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseDate, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { crearTareas, esquemaTarea, validarRecursos } from "@/lib/plan-tasks";
import { asignarPlan } from "@/lib/asignaciones";

const schema = z.object({
  name: z.string().min(3),
  description: z.string().optional().nullable(),
  /**
   * El equipo al que se le asigna, si se elige uno.
   *
   * Opcional a proposito: un plan es un catalogo —«Preventivo mensual
   * compresor»— y los equipos que lo siguen se asignan aparte, cada uno con su
   * propio calendario. Elegir uno aqui es el atajo comodo de crear y asignar
   * de un golpe cuando el plan es para un solo equipo.
   */
  assetId: z.string().optional().nullable(),
  meterId: z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  maintenanceType: z.enum(["PREVENTIVE", "PREDICTIVE", "INSPECTION"]).default("PREVENTIVE"),
  triggerType: z.enum(["CALENDAR", "METER", "CONDITION"]).default("CALENDAR"),
  intervalDays: z.coerce.number().int().positive().optional().nullable(),
  intervalMeter: z.coerce.number().positive().optional().nullable(),
  leadTimeDays: z.coerce.number().int().min(0).default(3),
  toleranceDays: z.coerce.number().int().min(0).default(2),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  estimatedHours: z.coerce.number().min(0).default(1),
  requiresShutdown: z.coerce.boolean().default(false),
  procedure: z.string().optional().nullable(),
  safetyNotes: z.string().optional().nullable(),
  nextDueDate: z.string().optional().nullable(),
  active: z.coerce.boolean().default(true),
  tasks: z.array(esquemaTarea).default([]),
});

export async function GET() {
  return withAuth(null, async ({ orgId }) => {
    const plans = await prisma.maintenancePlan.findMany({
      where: { organizationId: orgId },
      include: {
        asset: { select: { code: true, name: true } },
        meter: { select: { name: true, unit: true, currentValue: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: { nextDueDate: "asc" },
    });
    return ok({ plans });
  });
}

export async function POST(request: Request) {
  return withAuth("plan:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const { tasks, ...rest } = input;

    if (rest.triggerType === "CALENDAR" && !rest.intervalDays) {
      return ok({ error: "Un plan por calendario requiere intervalo en dias" }, 422);
    }
    if (rest.triggerType === "METER" && (!rest.intervalMeter || !rest.meterId)) {
      return ok({ error: "Un plan por medidor requiere medidor e intervalo" }, 422);
    }

    const problema = await validarRecursos(orgId, tasks);
    if (problema) return ok({ error: problema }, 422);

    const plan = await prisma.maintenancePlan.create({
      data: {
        ...rest,
        assetId: rest.assetId || null,
        organizationId: orgId,
        meterId: rest.meterId || null,
        assignedToId: rest.assignedToId || null,
        teamId: rest.teamId || null,
        nextDueDate: parseDate(rest.nextDueDate) ?? new Date(Date.now() + (rest.intervalDays ?? 30) * 86_400_000),
        tasks: { create: crearTareas(tasks) },
      },
    });

    /**
     * La asignacion, que es lo que de verdad hace que el plan genere.
     *
     * El programador itera PlanAsset, no los planes. Sin esta linea el plan se
     * ve bien en la lista, muestra fecha de vencimiento y no genera una sola
     * orden nunca, sin avisar. Diez planes quedaron asi antes de detectarlo.
     */
    if (rest.assetId) {
      await asignarPlan({
        organizationId: orgId,
        planId: plan.id,
        equipos: [{
          assetId: rest.assetId,
          desde: parseDate(rest.nextDueDate),
          meterId: rest.meterId || null,
        }],
        userId: user.id,
      });
    }

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "MaintenancePlan",
      entityId: plan.id,
      action: "CREATED",
      summary: plan.name,
    });
    return ok({ plan }, 201);
  });
}
