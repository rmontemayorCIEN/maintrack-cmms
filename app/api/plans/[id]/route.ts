import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { diariasSinConfirmar, esquemaTarea, validarRecursos } from "@/lib/plan-tasks";
import { reemplazarTareasConRastro } from "@/lib/tareas-con-rastro";
import { sembrarCalendarioDelPlan } from "@/lib/calendario-actividad";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  name: z.string().min(3).optional(),
  description: z.string().nullable().optional(),
  active: z.boolean().optional(),
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
    // El medidor es de cada equipo, no del plan: basta el intervalo.
    if (trigger === "METER" && !intervaloMedidor) {
      return fail("Un plan por medidor requiere el intervalo del medidor", 422);
    }

    // Al editar ya no se recibe equipo ni fecha: los equipos y sus fechas viven
    // en las asignaciones. Escribirlos en el encabezado era guardar un dato que
    // el programador no lee —el plan se veia asignado y no generaba—.
    //
    // El medidor tiene que ser de la misma empresa: llega por id desde el
    // navegador y no se puede dar por bueno.
    if (medidor) {
      const m = await prisma.meter.count({ where: { id: medidor, organizationId: orgId } });
      if (!m) return fail("Medidor no encontrado", 404);
    }
    if (tasks) {
      const problema = await validarRecursos(orgId, tasks);
      if (problema) return fail(problema, 422);
      const sinConfirmar = diariasSinConfirmar(tasks, dias, trigger);
      if (sinConfirmar.length) {
        return fail(
          `Confirme que estas actividades son diarias: ${sinConfirmar.join(", ")}. Una frecuencia diaria genera una visita cada día.`,
          409,
          { requiereConfirmacionDiaria: sinConfirmar },
        );
      }
    }

    const data: Record<string, unknown> = { ...input };
    if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId || null;
    if (input.teamId !== undefined) data.teamId = input.teamId || null;
    if (input.meterId !== undefined) data.meterId = input.meterId || null;
    if (trigger === "CALENDAR") { data.meterId = null; data.intervalMeter = null; }
    if (trigger === "METER") data.intervalDays = null;

    const plan = await prisma.maintenancePlan.update({ where: { id }, data });
    // Se pasa la cadencia que quedo guardada —no la del formulario— porque
    // reemplazarTareas la puede bajar si alguna actividad no encaja, y de ahi
    // salen los multiplos que se persisten.
    if (tasks) {
      await reemplazarTareasConRastro(id, tasks, plan.intervalDays, {
        organizationId: orgId, userId: user.id, triggerType: plan.triggerType,
      });
      // Una actividad recien agregada no tiene reloj en ninguno de los equipos
      // del plan. Sin esto no generaria nunca, y se veria igual que una que
      // todavia no toca.
      await sembrarCalendarioDelPlan(orgId, id);
    }

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
