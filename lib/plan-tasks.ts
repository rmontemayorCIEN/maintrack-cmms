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
  /**
   * Confirmacion explicita de que la actividad SI es diaria. Sin ella, una
   * frecuencia diaria no se guarda desde la pantalla (ver `diariasSinConfirmar`).
   */
  confirmarDiaria: z.boolean().optional(),
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

/**
 * Si una actividad es diaria: cada 1 dia, o sin frecuencia propia en un plan
 * por calendario que va cada dia.
 */
export function esFrecuenciaDiaria(
  t: { cadaCuanto?: number | null; unidadFrecuencia?: string | null; cadaDias?: number | null },
  intervalDelPlan?: number | null,
): boolean {
  const f = frecuenciaDe(t);
  if (f.cadaCuanto === null) return intervalDelPlan != null && intervalDelPlan <= 1;
  return f.unidadFrecuencia === "DIAS" && f.cadaCuanto <= 1;
}

/**
 * Las actividades diarias que llegan sin confirmar. Una rutina diaria es
 * valida (la revision de arranque de turno), pero tambien es el error de
 * captura mas caro: 365 visitas al ano en el calendario y en el backlog. Por
 * eso se pide confirmarla en vez de adivinar.
 */
export function diariasSinConfirmar(tareas: TareaDePlan[], intervalDelPlan?: number | null, triggerType = "CALENDAR") {
  if (triggerType !== "CALENDAR") return [];
  return tareas.filter((t) => t.title.trim() && esFrecuenciaDiaria(t, intervalDelPlan) && !t.confirmarDiaria).map((t) => t.title);
}

type Confirmador = { userId: string | null; ahora?: Date; intervalDelPlan?: number | null; triggerType?: string };

/** Los campos de confirmacion de una actividad nueva. */
function confirmacionNueva(t: TareaDePlan, quien?: Confirmador) {
  const diaria = (quien?.triggerType ?? "CALENDAR") === "CALENDAR" && esFrecuenciaDiaria(t, quien?.intervalDelPlan);
  return diaria && t.confirmarDiaria && quien?.userId
    ? { diariaConfirmadaPorId: quien.userId, diariaConfirmadaEl: quien.ahora ?? new Date() }
    : { diariaConfirmadaPorId: null, diariaConfirmadaEl: null };
}

/** Traduce las tareas del formulario a un `create` anidado de Prisma. */
export function crearTareas(tareas: TareaDePlan[], multiplos?: number[], quien?: Confirmador) {
  return tareas.map((t, index) => ({
    ...frecuenciaDe(t),
    ...confirmacionNueva(t, quien),
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
  quien?: Confirmador & { organizationId: string },
) {
  // La cadencia se recalcula al editar: cambiar la frecuencia de una actividad
  // puede mover la del plan entero, y guardar los multiplos contra una base
  // vieja daria un calendario que nadie puede cumplir.
  const cadencia = resolverCadenciaDelPlan(intervalBase, tareas);
  const ahora = quien?.ahora ?? new Date();
  const nuevas = crearTareas(tareas, cadencia.multiplos, { ...quien, userId: quien?.userId ?? null, ahora, intervalDelPlan: intervalBase });

  const existentes = await prisma.planTask.findMany({
    where: { planId },
    select: { id: true, title: true, diariaConfirmadaPorId: true, diariaConfirmadaEl: true },
  });
  const retiradas: Array<{ id: string; title: string; porque: string }> = [];
  const confirmadas: string[] = [];
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
      const antes = existentes.find((e) => e.id === previa)!;
      const sigueConfirmada = Boolean(campos.diariaConfirmadaEl);
      // Ya confirmada y sigue confirmada: se conserva quien y cuando.
      const confirmacion = antes.diariaConfirmadaEl && sigueConfirmada
        ? { diariaConfirmadaPorId: antes.diariaConfirmadaPorId, diariaConfirmadaEl: antes.diariaConfirmadaEl }
        : { diariaConfirmadaPorId: campos.diariaConfirmadaPorId, diariaConfirmadaEl: campos.diariaConfirmadaEl };
      if (!antes.diariaConfirmadaEl && sigueConfirmada) confirmadas.push(campos.title);
      if (antes.diariaConfirmadaEl && !sigueConfirmada) {
        retiradas.push({ id: previa, title: campos.title, porque: "la actividad dejó de ser diaria o se desmarcó la confirmación" });
      }
      operaciones.push(
        prisma.planTask.update({
          where: { id: previa },
          data: {
            ...campos,
            ...confirmacion,
            // Los recursos si se reemplazan enteros: son una plantilla y no
            // llevan historia propia.
            labor: { deleteMany: {}, ...labor },
            parts: { deleteMany: {}, ...parts },
            services: { deleteMany: {}, ...services },
          },
        }),
      );
    } else {
      if (campos.diariaConfirmadaEl) confirmadas.push(campos.title);
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
  return {
    ...cadencia,
    conservadas: conservados.size,
    creadas: nuevas.length - conservados.size,
    borradas: sobran.length,
    // Para la bitacora (la escribe `lib/tareas-con-rastro.ts`, solo servidor:
    // este archivo tambien lo importan pantallas del navegador).
    confirmacionesNuevas: confirmadas,
    confirmacionesRetiradas: retiradas.map((r) => {
      const antes = existentes.find((e) => e.id === r.id)!;
      return { ...r, confirmadaPorId: antes.diariaConfirmadaPorId, confirmadaEl: antes.diariaConfirmadaEl };
    }),
  };
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

/**
 * Agrega refacciones a actividades concretas de un plan, sin tocar lo demas.
 *
 * `reemplazarTareas` rehace el plan entero y recalcula la cadencia: sirve para
 * editar, no para completar. Aqui solo se le cuelga material a las actividades
 * que se eligieron, y por eso lo puede usar lo que propone la IA sin riesgo de
 * mover frecuencias que nadie pidio cambiar.
 *
 * Se agrega, no se pisa: si la actividad ya tenia esa refaccion, se deja la
 * cantidad que estaba. Quien la capturo sabia algo que la propuesta no.
 */
export async function agregarRefaccionesAActividades(
  organizationId: string,
  planId: string,
  lineas: Array<{ taskId: string; refacciones: Array<{ partId: string; cantidad: number }> }>,
): Promise<{ actividades: number; refacciones: number }> {
  if (!lineas.length) return { actividades: 0, refacciones: 0 };

  // Que las actividades sean de ESTE plan y de ESTA empresa: un id ajeno no
  // puede colgarle material al plan de otro cliente.
  const validas = new Set(
    (await prisma.planTask.findMany({
      where: { planId, id: { in: lineas.map((l) => l.taskId) }, plan: { organizationId } },
      select: { id: true },
    })).map((t) => t.id),
  );
  const partesValidas = new Set(
    (await prisma.part.findMany({
      where: { organizationId, active: true, id: { in: lineas.flatMap((l) => l.refacciones.map((r) => r.partId)) } },
      select: { id: true },
    })).map((p) => p.id),
  );

  let actividades = 0;
  let refacciones = 0;
  for (const l of lineas) {
    if (!validas.has(l.taskId)) continue;
    const utiles = l.refacciones.filter((r) => partesValidas.has(r.partId) && r.cantidad > 0);
    if (!utiles.length) continue;
    const ya = new Set(
      (await prisma.planTaskPart.findMany({ where: { planTaskId: l.taskId }, select: { partId: true } })).map((x) => x.partId),
    );
    const nuevas = utiles.filter((r) => !ya.has(r.partId));
    if (!nuevas.length) continue;
    await prisma.planTaskPart.createMany({
      data: nuevas.map((r) => ({ planTaskId: l.taskId, partId: r.partId, quantity: r.cantidad })),
    });
    actividades += 1;
    refacciones += nuevas.length;
  }
  return { actividades, refacciones };
}
