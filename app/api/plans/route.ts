import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseDate, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { diariasSinConfirmar, esquemaTarea } from "@/lib/plan-tasks";
import { altaDePlan } from "@/lib/alta-de-plan";

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
  /** Los equipos a los que se aplica desde el alta. */
  assetIds: z.array(z.string().min(1)).default([]),
  /** La fecha comun de sus actividades, y que significa. */
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  desdeEsUltima: z.boolean().optional(),
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

    const sinConfirmar = diariasSinConfirmar(input.tasks, input.intervalDays, input.triggerType);
    if (sinConfirmar.length) {
      return fail(
        `Confirme que estas actividades son diarias: ${sinConfirmar.join(", ")}. Una frecuencia diaria genera una visita cada día.`,
        409,
        { requiereConfirmacionDiaria: sinConfirmar },
      );
    }

    const r = await altaDePlan(orgId, user.id, input);
    if ("error" in r) return ok({ error: r.error }, 422);
    const plan = r.plan;

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "MaintenancePlan",
      entityId: plan.id,
      action: "CREATED",
      summary: plan.name,
    });
    return ok({ plan, sinMedidor: r.sinMedidor }, 201);
  });
}
