import type { Prisma } from "@prisma/client";
import { incluirTareas } from "@/lib/plan-tasks";

/**
 * Un plan guardado, en la forma que espera el diálogo de edición.
 *
 * Lo usan la lista de planes y el expediente de un plan: si cada una armara
 * su propia conversión, un campo nuevo quedaría en una y no en la otra.
 */
export type PlanParaEditar = Prisma.MaintenancePlanGetPayload<{
  include: { tasks: typeof incluirTareas; asignaciones: { select: { asset: { select: { code: true } } } } };
}>;

export function planParaEditar(plan: PlanParaEditar) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    equipos: plan.asignaciones.map((a) => a.asset.code),
    maintenanceType: plan.maintenanceType,
    triggerType: plan.triggerType,
    intervalDays: plan.intervalDays,
    intervalMeter: plan.intervalMeter,
    meterId: plan.meterId,
    leadTimeDays: plan.leadTimeDays,
    priority: plan.priority,
    estimatedHours: plan.estimatedHours,
    assignedToId: plan.assignedToId,
    requiresShutdown: plan.requiresShutdown,
    procedure: plan.procedure,
    safetyNotes: plan.safetyNotes,
    tasks: plan.tasks.map((t) => ({
      title: t.title,
      taskType: t.taskType,
      unit: t.unit ?? undefined,
      minValue: t.minValue != null ? String(t.minValue) : undefined,
      maxValue: t.maxValue != null ? String(t.maxValue) : undefined,
      required: t.required,
      /**
       * La frecuencia, en las palabras en que se guardo.
       *
       * Vacio significa "la frecuencia del plan", que es el caso de siempre
       * y por eso es lo que no hay que capturar. Un plan anterior al
       * calendario por actividad no trae `cadaCuanto` y cae ahi solo.
       */
      cadaCuanto: t.cadaCuanto ? String(t.cadaCuanto) : undefined,
      unidadFrecuencia: t.unidadFrecuencia ?? "DIAS",
      confirmarDiaria: Boolean(t.diariaConfirmadaEl),
      labor: t.labor.map((l) => ({
        specialtyId: l.specialtyId, personas: String(l.personas), hours: String(l.hours),
      })),
      parts: t.parts.map((p) => ({ partId: p.partId, quantity: String(p.quantity) })),
      services: t.services.map((s) => ({
        serviceId: s.serviceId, quantity: String(s.quantity), nota: s.nota ?? "",
      })),
      tools: t.tools.map((h) => ({
        fuente: (h.partId ? "ALMACEN" : h.assetId ? "ACTIVO" : "CAJA") as "ALMACEN" | "ACTIVO" | "CAJA",
        id: h.partId ?? h.assetId ?? h.kitId ?? "",
        cantidad: String(h.cantidad),
        nota: h.nota ?? "",
      })),
    })),
  };
}
