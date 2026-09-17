import { logAudit } from "./audit";
import { reemplazarTareas, type TareaDePlan } from "./plan-tasks";

/**
 * Guarda las actividades de un plan y deja en la bitacora lo que cambio de sus
 * confirmaciones de rutina diaria: quien confirmo, y cuando y por que se
 * retiro una confirmacion.
 *
 * Vive aparte de `plan-tasks.ts` porque ese archivo tambien lo importan
 * pantallas del navegador, y la bitacora arrastra modulos solo de servidor.
 */
export async function reemplazarTareasConRastro(
  planId: string,
  tareas: TareaDePlan[],
  intervalBase: number | null | undefined,
  quien: { organizationId: string; userId: string | null; triggerType?: string; ahora?: Date },
) {
  const r = await reemplazarTareas(planId, tareas, intervalBase, quien);
  if (r.confirmacionesNuevas.length) {
    await logAudit({
      organizationId: quien.organizationId,
      userId: quien.userId,
      entity: "MaintenancePlan",
      entityId: planId,
      action: "CONFIRMACION_DIARIA",
      summary: `Rutina diaria confirmada: ${r.confirmacionesNuevas.join(", ")}`,
    });
  }
  for (const x of r.confirmacionesRetiradas) {
    await logAudit({
      organizationId: quien.organizationId,
      userId: quien.userId,
      entity: "PlanTask",
      entityId: x.id,
      action: "CONFIRMACION_DIARIA_RETIRADA",
      summary: `${x.title}: se retiró la confirmación de rutina diaria (${x.porque})`,
      changes: { confirmadaPorId: x.confirmadaPorId, confirmadaEl: x.confirmadaEl?.toISOString() ?? null, motivo: x.porque },
    });
  }
  return r;
}
