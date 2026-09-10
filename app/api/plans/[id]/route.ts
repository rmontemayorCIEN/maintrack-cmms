import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, parseDate, withAuth } from "@/lib/api";
import { esquemaTarea, reemplazarTareas, validarRecursos } from "@/lib/plan-tasks";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(3).optional(),
  description: z.string().nullable().optional(),
  active: z.boolean().optional(),
  assetId: z.string().min(1).optional(),
  maintenanceType: z.enum(["PREVENTIVE", "PREDICTIVE", "INSPECTION"]).optional(),
  triggerType: z.enum(["CALENDAR", "METER", "CONDITION"]).optional(),
  meterId: z.string().nullable().optional(),
  intervalDays: z.coerce.number().int().positive().nullable().optional(),
  intervalMeter: z.coerce.number().positive().nullable().optional(),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  estimatedHours: z.coerce.number().min(0).optional(),
  requiresShutdown: z.coerce.boolean().optional(),
  assignedToId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
  nextDueDate: z.string().nullable().optional(),
  procedure: z.string().nullable().optional(),
  safetyNotes: z.string().nullable().optional(),
  /** Si viene, reemplaza por completo la lista de actividades del plan. */
  tasks: z.array(esquemaTarea).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("plan:write", async ({ user, orgId }) => {
    const existing = await prisma.maintenancePlan.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return fail("Plan no encontrado", 404);
    const { tasks, ...input } = schema.parse(await request.json());

    const trigger = input.triggerType ?? existing.triggerType;
    const dias = input.intervalDays !== undefined ? input.intervalDays : existing.intervalDays;
    const medidor = input.meterId !== undefined ? input.meterId : existing.meterId;
    const intervaloMedidor = input.intervalMeter !== undefined ? input.intervalMeter : existing.intervalMeter;
    if (trigger === "CALENDAR" && !dias) return fail("Un plan por calendario requiere intervalo en días", 422);
    if (trigger === "METER" && (!intervaloMedidor || !medidor)) {
      return fail("Un plan por medidor requiere medidor e intervalo", 422);
    }

    // El activo y el medidor tienen que ser de la misma empresa: llegan por id
    // desde el navegador y no se pueden dar por buenos.
    if (input.assetId) {
      const activo = await prisma.asset.count({ where: { id: input.assetId, organizationId: orgId } });
      if (!activo) return fail("Activo no encontrado", 404);
    }
    if (medidor) {
      const m = await prisma.meter.count({ where: { id: medidor, organizationId: orgId } });
      if (!m) return fail("Medidor no encontrado", 404);
    }
    if (tasks) {
      const problema = await validarRecursos(orgId, tasks);
      if (problema) return fail(problema, 422);
    }

    const data: Record<string, unknown> = { ...input };
    if (input.nextDueDate !== undefined) data.nextDueDate = parseDate(input.nextDueDate);
    if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId || null;
    if (input.teamId !== undefined) data.teamId = input.teamId || null;
    if (input.meterId !== undefined) data.meterId = input.meterId || null;
    if (trigger === "CALENDAR") { data.meterId = null; data.intervalMeter = null; }
    if (trigger === "METER") data.intervalDays = null;

    const plan = await prisma.maintenancePlan.update({ where: { id }, data });
    // Se pasa la cadencia que quedo guardada —no la del formulario— porque
    // reemplazarTareas la puede bajar si alguna actividad no encaja, y de ahi
    // salen los multiplos que se persisten.
    if (tasks) await reemplazarTareas(id, tasks, plan.intervalDays);

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "MaintenancePlan",
      entityId: plan.id,
      action: "UPDATED",
      summary: plan.name,
    });
    return ok({ plan });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("plan:write", async ({ orgId }) => {
    const existing = await prisma.maintenancePlan.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) return fail("Plan no encontrado", 404);
    await prisma.maintenancePlan.delete({ where: { id } });
    return ok({ success: true });
  });
}
