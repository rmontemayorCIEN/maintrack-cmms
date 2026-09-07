import { z } from "zod";
import { prisma } from "./db";

/**
 * Las actividades de un plan y los recursos que cada una requiere.
 *
 * Un plan no dice solo "que hay que hacer" sino "con que": las horas-hombre por
 * especialidad, las refacciones que hay que tener en almacen y los servicios
 * que hay que contratar afuera. Con eso el programador sabe que comprar y con
 * cuanta anticipacion, y el plan se puede costear antes de ejecutarlo.
 *
 * Los recursos son una estimacion. Lo que realmente se gasto vive en la orden
 * de trabajo (WorkOrderLabor, WorkOrderPart, WorkOrderService).
 */

export const esquemaTarea = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().optional().nullable(),
  taskType: z.string().default("CHECK"),
  unit: z.string().trim().optional().nullable(),
  minValue: z.coerce.number().optional().nullable(),
  maxValue: z.coerce.number().optional().nullable(),
  required: z.boolean().default(true),
  labor: z.array(z.object({
    specialtyId: z.string().min(1),
    personas: z.coerce.number().int().min(1).max(99).default(1),
    hours: z.coerce.number().min(0).max(999).default(1),
  })).default([]),
  parts: z.array(z.object({
    partId: z.string().min(1),
    quantity: z.coerce.number().min(0).default(1),
  })).default([]),
  services: z.array(z.object({
    serviceId: z.string().min(1),
    quantity: z.coerce.number().min(0).default(1),
    nota: z.string().trim().max(200).optional().nullable(),
  })).default([]),
});

export type TareaDePlan = z.infer<typeof esquemaTarea>;

/** Include estandar para traer un plan con todo lo que cuelga de sus tareas. */
export const incluirTareas = {
  orderBy: { position: "asc" },
  include: {
    labor: { include: { specialty: { select: { id: true, code: true, name: true, hourlyRate: true } } } },
    parts: { include: { part: { select: { id: true, code: true, name: true, unit: true, unitCost: true } } } },
    services: { include: { service: { select: { id: true, code: true, name: true, unit: true, unitCost: true } } } },
  },
} as const;

/**
 * Verifica que refacciones, especialidades y servicios referidos existan y sean
 * de la misma organizacion. Sin esto un cliente podria colgar de su plan la
 * refaccion de otro con solo mandar el id.
 */
export async function validarRecursos(orgId: string, tareas: TareaDePlan[]): Promise<string | null> {
  const especialidades = [...new Set(tareas.flatMap((t) => t.labor.map((l) => l.specialtyId)))];
  const refacciones = [...new Set(tareas.flatMap((t) => t.parts.map((p) => p.partId)))];
  const servicios = [...new Set(tareas.flatMap((t) => t.services.map((s) => s.serviceId)))];

  const [ne, nr, ns] = await Promise.all([
    especialidades.length
      ? prisma.specialty.count({ where: { id: { in: especialidades }, organizationId: orgId } })
      : 0,
    refacciones.length
      ? prisma.part.count({ where: { id: { in: refacciones }, organizationId: orgId } })
      : 0,
    servicios.length
      ? prisma.externalService.count({ where: { id: { in: servicios }, organizationId: orgId } })
      : 0,
  ]);

  if (ne !== especialidades.length) return "Alguna especialidad ya no existe";
  if (nr !== refacciones.length) return "Alguna refacción ya no existe";
  if (ns !== servicios.length) return "Algun servicio externo ya no existe";
  return null;
}

/** Traduce las tareas del formulario a un `create` anidado de Prisma. */
export function crearTareas(tareas: TareaDePlan[]) {
  return tareas.map((t, index) => ({
    position: index,
    title: t.title,
    description: t.description || null,
    taskType: t.taskType,
    unit: t.unit || null,
    minValue: t.minValue ?? null,
    maxValue: t.maxValue ?? null,
    required: t.required,
    labor: { create: t.labor.map((l) => ({ specialtyId: l.specialtyId, personas: l.personas, hours: l.hours })) },
    parts: { create: t.parts.map((p) => ({ partId: p.partId, quantity: p.quantity })) },
    services: { create: t.services.map((s) => ({ serviceId: s.serviceId, quantity: s.quantity, nota: s.nota || null })) },
  }));
}

/**
 * Reemplaza por completo la lista de actividades de un plan.
 *
 * Se borra y se vuelve a crear en lugar de reconciliar fila por fila: las
 * tareas de un plan son una plantilla, no historia. Lo que ya se ejecuto vive
 * copiado en las ordenes generadas y no se toca.
 */
export async function reemplazarTareas(planId: string, tareas: TareaDePlan[]) {
  await prisma.$transaction([
    prisma.planTask.deleteMany({ where: { planId } }),
    ...crearTareas(tareas).map((data) => prisma.planTask.create({ data: { ...data, planId } })),
  ]);
}

type TareaConRecursos = {
  labor: Array<{ personas: number; hours: number; specialty: { hourlyRate: number } }>;
  parts: Array<{ quantity: number; part: { unitCost: number } }>;
  services: Array<{ quantity: number; service: { unitCost: number } }>;
};

/** Costo y horas estimadas de un plan a partir de los recursos de sus tareas. */
export function costearPlan(tareas: TareaConRecursos[]) {
  let horas = 0, manoObra = 0, refacciones = 0, servicios = 0;
  for (const t of tareas) {
    for (const l of t.labor) {
      const h = l.personas * l.hours;
      horas += h;
      manoObra += h * l.specialty.hourlyRate;
    }
    for (const p of t.parts) refacciones += p.quantity * p.part.unitCost;
    for (const s of t.services) servicios += s.quantity * s.service.unitCost;
  }
  return { horas, manoObra, refacciones, servicios, total: manoObra + refacciones + servicios };
}
