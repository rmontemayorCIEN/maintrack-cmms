import { prisma } from "@/lib/db";
import { diaLocal } from "@/lib/utils";
import { crearTareas, validarRecursos } from "@/lib/plan-tasks";
import { resolverCadenciaDelPlan } from "@/lib/frecuencias";
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
  /**
   * Los equipos a los que se aplica desde el alta. Un plan es para uno O VARIOS
   * equipos iguales; el campo de un solo equipo del encabezado era un resto de
   * cuando no era asi, y al editarlo escribia un dato que el programador no lee.
   * `assetId` se sigue aceptando como un equipo mas, por compatibilidad.
   */
  assetIds?: string[];
  /** La fecha comun de las actividades en esos equipos (aaaa-mm-dd). */
  desde?: string | null;
  /** Si `desde` es "la ultima vez que se hizo" o "cuando arranca". */
  desdeEsUltima?: boolean;
};

export async function altaDePlan(
  organizationId: string,
  userId: string | null,
  entrada: EntradaAltaDePlan,
): Promise<{ plan: { id: string; name: string }; sinMedidor: string[] } | { error: string }> {
  const { tasks, assetIds, desde, desdeEsUltima, ...rest } = entrada;
  const equipos = [...new Set([...(assetIds ?? []), ...(rest.assetId ? [rest.assetId] : [])])];

  if (rest.triggerType === "CALENDAR" && !rest.intervalDays) {
    return { error: "Un plan por calendario requiere intervalo en días" };
  }
  // El medidor NO es del plan: cada equipo usa el suyo, y se toma al asignarlo.
  // Exigir uno aqui obligaba a elegir el medidor de un solo equipo para un plan
  // que se aplica a varios.
  if (rest.triggerType === "METER" && !rest.intervalMeter) {
    return { error: "Un plan por medidor requiere el intervalo del medidor" };
  }

  const problema = await validarRecursos(organizationId, tasks);
  if (problema) return { error: problema };

  /**
   * La cadencia base sale de las frecuencias, no al reves.
   *
   * Si una actividad va cada 45 dias en un plan mensual, el equipo se visita
   * cada 15 —el ritmo que hace encajar las dos— y cada actividad lleva su
   * multiplo. La pantalla lo enseña antes de guardar para que no sorprenda.
   */
  const cadencia = resolverCadenciaDelPlan(rest.intervalDays, tasks);

  const plan = await prisma.maintenancePlan.create({
    data: {
      ...rest,
      intervalDays: cadencia.base,
      // El equipo con el que nacio, solo como referencia historica: lo que
      // genera ordenes son las asignaciones de abajo.
      assetId: equipos[0] ?? null,
      organizationId,
      meterId: rest.meterId || null,
      assignedToId: rest.assignedToId || null,
      teamId: rest.teamId || null,
      nextDueDate:
        diaLocal(rest.nextDueDate) ??
        new Date(Date.now() + (cadencia.base ?? 30) * 86_400_000),
      tasks: { create: crearTareas(tasks, cadencia.multiplos, { userId, intervalDelPlan: cadencia.base, triggerType: rest.triggerType }) },
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
  let sinMedidor: string[] = [];
  if (equipos.length) {
    const fecha = diaLocal(desde ?? rest.nextDueDate);
    const r = await asignarPlan({
      organizationId,
      planId: plan.id,
      equipos: equipos.map((assetId) => ({
        assetId,
        desde: fecha,
        desdeEsUltima: desdeEsUltima ?? false,
        // Con un solo equipo, el medidor elegido (si vino) es el suyo.
        meterId: equipos.length === 1 ? rest.meterId || null : null,
      })),
      userId,
    });
    sinMedidor = r.sinMedidor;
  }

  return { plan, sinMedidor };
}
