import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { resolverCadenciaDelPlan } from "./frecuencias";
import { desdeDias, esUnidad, UNIDADES, type Unidad } from "./calendario";

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
  /**
   * Cada cuantos dias va esta actividad. Nulo: la cadencia del plan.
   *
   * Se conserva porque lo escriben el generador de IA, la importacion y las
   * pantallas viejas. Si no viene `cadaCuanto`, de aqui se deriva: 90 dias son
   * "cada 3 meses" y no "cada 90 dias", que es como lo diria una persona.
   */
  cadaDias: z.coerce.number().int().min(1).optional().nullable(),
  /** Cada cuanto toca, en la unidad de al lado. */
  cadaCuanto: z.coerce.number().int().min(1).optional().nullable(),
  /** DIAS | SEMANAS | MESES. */
  unidadFrecuencia: z.enum([UNIDADES.DIAS, UNIDADES.SEMANAS, UNIDADES.MESES]).optional().nullable(),
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

/**
 * La frecuencia de una actividad, venga como venga.
 *
 * Hay tres formas de llegar aqui y las tres tienen que dar el mismo calendario:
 * la pantalla manda numero y unidad, el generador de IA y la importacion mandan
 * dias, y una actividad vieja no manda nada. Resolverlo en un solo lugar evita
 * que cada camino invente su propia interpretacion.
 */
export function frecuenciaDe(t: {
  cadaCuanto?: number | null;
  unidadFrecuencia?: string | null;
  cadaDias?: number | null;
}): { cadaCuanto: number | null; unidadFrecuencia: Unidad } {
  if (t.cadaCuanto && esUnidad(t.unidadFrecuencia)) {
    return { cadaCuanto: t.cadaCuanto, unidadFrecuencia: t.unidadFrecuencia };
  }
  if (t.cadaCuanto) return { cadaCuanto: t.cadaCuanto, unidadFrecuencia: "DIAS" };
  if (t.cadaDias) {
    const d = desdeDias(t.cadaDias);
    return { cadaCuanto: d.cadaCuanto, unidadFrecuencia: d.unidad };
  }
  return { cadaCuanto: null, unidadFrecuencia: "DIAS" };
}

/** Traduce las tareas del formulario a un `create` anidado de Prisma. */
export function crearTareas(tareas: TareaDePlan[], multiplos?: number[]) {
  return tareas.map((t, index) => ({
    ...frecuenciaDe(t),
    // El multiplo lo calcula resolverCadenciaDelPlan a partir de los dias; si
    // no viene, es 1 y la actividad sale en cada ejecucion —lo de siempre—.
    cadaCuantas: multiplos?.[index] ?? 1,
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
 * Deja la lista de actividades de un plan igual a la que se capturo,
 * CONSERVANDO la identidad de las que siguen ahi.
 *
 * Antes se borraba todo y se volvia a crear. Se veia bien y rompia dos cosas
 * en silencio, las dos invisibles desde la pantalla:
 *
 *  - **El historial.** `WorkOrderTask.planTaskId` guarda de que actividad del
 *    plan salio cada renglon de cada orden, y no es una llave foranea: es una
 *    cadena suelta. Al recrear las actividades con ids nuevos, todas las
 *    ordenes viejas quedaban apuntando a ids que ya no existen. La pregunta
 *    "cuando se cambio el aceite por ultima vez" dejaba de tener respuesta
 *    cada vez que alguien corregia una falta de ortografia en el plan.
 *  - **El calendario.** Los relojes por actividad y equipo cuelgan de la
 *    actividad con borrado en cascada. Recrear la lista borraba el calendario
 *    de todos los equipos del plan y los devolvia al arranque.
 *
 * Ahora se emparejan por titulo: la actividad que sigue llamandose igual
 * conserva su id, su historial y su reloj. Solo se crean las nuevas y solo se
 * borran las que de verdad se quitaron.
 */
const claveDeTitulo = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

export async function reemplazarTareas(
  planId: string,
  tareas: TareaDePlan[],
  intervalBase?: number | null,
) {
  // La cadencia se recalcula al editar: cambiar la frecuencia de una actividad
  // puede mover la del plan entero, y guardar los multiplos contra una base
  // vieja daria un calendario que nadie puede cumplir.
  const cadencia = resolverCadenciaDelPlan(intervalBase, tareas);
  const nuevas = crearTareas(tareas, cadencia.multiplos);

  const existentes = await prisma.planTask.findMany({
    where: { planId },
    select: { id: true, title: true },
  });
  const porTitulo = new Map<string, string>();
  for (const t of existentes) {
    const k = claveDeTitulo(t.title);
    // Con titulos repetidos gana el primero; el segundo se crea de nuevo. Es
    // preferible perder el vinculo de un duplicado que asignarselo al que no.
    if (!porTitulo.has(k)) porTitulo.set(k, t.id);
  }

  const conservados = new Set<string>();
  const operaciones: Prisma.PrismaPromise<unknown>[] = [];

  for (const data of nuevas) {
    const { labor, parts, services, ...campos } = data;
    const previa = porTitulo.get(claveDeTitulo(campos.title));

    if (previa && !conservados.has(previa)) {
      conservados.add(previa);
      operaciones.push(
        prisma.planTask.update({
          where: { id: previa },
          data: {
            ...campos,
            // Los recursos si se reemplazan enteros: son una plantilla y no
            // llevan historia propia.
            labor: { deleteMany: {}, ...labor },
            parts: { deleteMany: {}, ...parts },
            services: { deleteMany: {}, ...services },
          },
        }),
      );
    } else {
      operaciones.push(prisma.planTask.create({ data: { ...data, planId } }));
    }
  }

  const sobran = existentes.filter((t) => !conservados.has(t.id)).map((t) => t.id);
  if (sobran.length) {
    operaciones.push(prisma.planTask.deleteMany({ where: { id: { in: sobran } } }));
  }
  if (cadencia.base != null) {
    operaciones.push(
      prisma.maintenancePlan.update({ where: { id: planId }, data: { intervalDays: cadencia.base } }),
    );
  }

  await prisma.$transaction(operaciones);
  return { ...cadencia, conservadas: conservados.size, creadas: nuevas.length - conservados.size, borradas: sobran.length };
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

/**
 * Que actividades del plan trae DE VERDAD una orden.
 *
 * Una orden ya no trae el plan completo: el gestor puede mandar tres de cinco
 * actividades en una y dos en otra, y el programador solo mete las que tocan.
 * Todo lo que se deriva "del plan" para una orden —los recursos a preparar, la
 * requisicion al almacen— tiene que salir de las actividades de la orden, no
 * del plan entero. Si no, una orden con solo el cambio de aceite pediria al
 * almacen tambien los rodamientos de la revision anual, cada mes.
 *
 * Las ordenes viejas no dicen de que actividad salio cada renglon
 * (`planTaskId` es reciente). Para esas se cae al plan completo, que es lo que
 * se hacia antes: de mas, pero igual que siempre.
 *
 * Devuelve el filtro para `planTask.findMany`, o nulo si la orden no trae nada
 * de ningun plan.
 */
export async function filtroDeActividadesDeLaOrden(
  workOrderId: string,
): Promise<Prisma.PlanTaskWhereInput | null> {
  const [orden, renglones] = await Promise.all([
    prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { planId: true } }),
    prisma.workOrderTask.findMany({
      where: { workOrderId },
      select: { planTaskId: true, origen: true, origenPlanId: true },
    }),
  ]);

  const ids = [...new Set(renglones.map((r) => r.planTaskId).filter(Boolean) as string[])];
  const planesSinVinculo = [
    ...new Set(
      renglones
        .filter((r) => r.origen === "PLAN" && !r.planTaskId)
        .map((r) => r.origenPlanId ?? orden?.planId)
        .filter(Boolean) as string[],
    ),
  ];
  // Una orden de plan sin renglones todavia —recien creada a mano— se sigue
  // leyendo por su encabezado.
  if (!ids.length && !planesSinVinculo.length && orden?.planId && !renglones.length) {
    planesSinVinculo.push(orden.planId);
  }

  const condiciones: Prisma.PlanTaskWhereInput[] = [];
  if (ids.length) condiciones.push({ id: { in: ids } });
  if (planesSinVinculo.length) condiciones.push({ planId: { in: planesSinVinculo } });
  if (!condiciones.length) return null;
  return condiciones.length === 1 ? condiciones[0] : { OR: condiciones };
}
