import { prisma } from "@/lib/db";
import { parseDate } from "@/lib/api";
import { crearTareas, validarRecursos } from "@/lib/plan-tasks";
import { asignarPlan } from "@/lib/asignaciones";

/**
 * Dar de alta un plan de mantenimiento, con su asignacion si trae equipo.
 *
 * Vive fuera de la ruta para que la prueba llame exactamente lo mismo que
 * corre en produccion. La version anterior de la prueba replicaba estos pasos
 * por su cuenta —creaba el plan y luego asignaba— y por eso no detecto que el
 * endpoint nunca asignaba: la prueba hacia lo correcto mientras el sistema
 * hacia lo incorrecto, y las dos pasaban.
 */
export type EntradaAltaDePlan = {
  name: string;
  description?: string | null;
  assetId?: string | null;
  meterId?: string | null;
  assignedToId?: string | null;
  teamId?: string | null;
  maintenanceType: string;
  triggerType: string;
  intervalDays?: number | null;
  intervalMeter?: number | null;
  leadTimeDays: number;
  toleranceDays: number;
  priority: string;
  estimatedHours: number;
  requiresShutdown: boolean;
  procedure?: string | null;
  safetyNotes?: string | null;
  nextDueDate?: string | null;
  active: boolean;
  tasks: Parameters<typeof crearTareas>[0];
};

export async function altaDePlan(
  organizationId: string,
  userId: string | null,
  entrada: EntradaAltaDePlan,
): Promise<{ plan: { id: string; name: string } } | { error: string }> {
  const { tasks, ...rest } = entrada;

  if (rest.triggerType === "CALENDAR" && !rest.intervalDays) {
    return { error: "Un plan por calendario requiere intervalo en dias" };
  }
  if (rest.triggerType === "METER" && (!rest.intervalMeter || !rest.meterId)) {
    return { error: "Un plan por medidor requiere medidor e intervalo" };
  }

  const problema = await validarRecursos(organizationId, tasks);
  if (problema) return { error: problema };

  const plan = await prisma.maintenancePlan.create({
    data: {
      ...rest,
      assetId: rest.assetId || null,
      organizationId,
      meterId: rest.meterId || null,
      assignedToId: rest.assignedToId || null,
      teamId: rest.teamId || null,
      nextDueDate:
        parseDate(rest.nextDueDate) ??
        new Date(Date.now() + (rest.intervalDays ?? 30) * 86_400_000),
      tasks: { create: crearTareas(tasks) },
    },
    select: { id: true, name: true },
  });

  /**
   * La asignacion, que es lo que de verdad hace que el plan genere.
   *
   * El programador itera PlanAsset, no los planes. Sin esto el plan se ve bien
   * en la lista, muestra fecha de vencimiento y no genera una sola orden
   * nunca, sin avisar. Diez planes quedaron asi antes de detectarlo.
   *
   * Sin equipo no se asigna nada y esta bien: el plan queda en el catalogo,
   * para asignarlo despues en Equipos y sus planes.
   */
  if (rest.assetId) {
    await asignarPlan({
      organizationId,
      planId: plan.id,
      equipos: [{
        assetId: rest.assetId,
        desde: parseDate(rest.nextDueDate),
        meterId: rest.meterId || null,
      }],
      userId,
    });
  }

  return { plan };
}
