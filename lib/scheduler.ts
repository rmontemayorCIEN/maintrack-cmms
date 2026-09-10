import { prisma } from "./db";
import { nextWorkOrderNumber } from "./numbering";
import { tocanEn } from "./frecuencias";
import { addDays, startOfDay } from "./utils";
import { logAudit, notify } from "./audit";
import { esHabil, jornada } from "./agenda";
import {
  actividadesPendientes,
  proyectarActividades,
  reglaDeOrganizacion,
  sembrarLoQueFalte,
} from "./calendario-actividad";

export type GenerationResult = {
  generated: number;
  skipped: number;
  details: Array<{ plan: string; workOrder?: string; reason?: string }>;
};

/**
 * Motor de programacion preventiva.
 *
 * Recorre los planes activos y genera la orden de trabajo cuando la fecha de
 * vencimiento (o la lectura del medidor) entra en la ventana de anticipacion
 * `leadTimeDays`. Evita duplicados: si ya existe una OT abierta del mismo plan
 * no se genera otra.
 *
 * Reglas:
 *  - CALENDAR: nextDueDate = ultima ejecucion + intervalDays.
 *  - METER: se proyecta con el promedio diario del medidor para estimar la
 *    fecha de vencimiento y respetar la anticipacion.
 */
/**
 * Que equipo cuenta como en servicio para efectos de programar preventivos.
 *
 * Un equipo dado de baja NO debe generar planes, y hasta hoy los generaba: el
 * programador filtraba por PlanAsset.active y plan.active, pero nunca miraba
 * el equipo. Se retiraba un activo —desaparecia de la lista, todo se veia
 * bien— y el sistema seguia emitiendo preventivos para el, para siempre. Un
 * tecnico recibiendo una orden de un equipo que ya no existe.
 *
 * Se filtra por las DOS formas de estar fuera: `active: false` es la baja
 * logica que hace la pantalla, y `status: RETIRED` se puede poner solo desde
 * la ficha sin tocar `active`. Cubrir una y no la otra habria dejado el mismo
 * defecto por la puerta de al lado.
 *
 * Va aqui y no en la baja del activo a proposito: asi protege venga de donde
 * venga —pantalla, importacion, script— y si el equipo se reactiva, sus planes
 * vuelven solos sin que nadie tenga que acordarse.
 *
 * OJO: esto NO cubre el equipo en STANDBY, que hoy sigue generando planes.
 * Eso es una decision de diseno pendiente y no un defecto: hay preventivos que
 * existen JUSTO porque el equipo esta parado —rotar flechas, revisar sellos—,
 * asi que suspenderlos todos seria tan incorrecto como no suspender ninguno.
 */
const EQUIPO_EN_SERVICIO = { active: true, status: { not: "RETIRED" } } as const;

/**
 * El camino de los planes POR MEDIDOR.
 *
 * Sigue programando por asignacion —una fecha para todo el plan— porque un
 * medidor es otro eje: la fecha se estima con el consumo promedio del equipo,
 * no con un intervalo de calendario. Pasarlo al calendario por actividad exige
 * primero que la actividad pueda decir a QUE medidor mira, que es un cambio
 * aparte y todavia no esta hecho.
 *
 * Se deja tal como estaba a proposito. Mezclar los dos cambios en una sola
 * entrega habria dejado sin forma de saber cual de los dos rompio que.
 */
async function generarPorMedidor(
  organizationId: string,
  options: { horizonDays?: number; userId?: string | null; dryRun?: boolean } = {},
): Promise<GenerationResult> {
  const horizon = options.horizonDays ?? 0;
  const today = startOfDay(new Date());
  const result: GenerationResult = { generated: 0, skipped: 0, details: [] };

  // La jornada de la organizacion, una sola vez: sirve para no programar
  // trabajo en domingo ni el 25 de diciembre. Se lee con margen hacia adelante
  // porque el horizonte puede empujar una fecha varios meses.
  const j = await jornada(
    organizationId,
    today,
    new Date(today.getFullYear(), today.getMonth() + 14, 1),
  );

  // Se recorren ASIGNACIONES, no planes.
  //
  // Un plan puede servir a diez compresores iguales y cada uno tiene su propia
  // fecha: uno se instalo en marzo y otro en agosto. La asignacion es donde
  // vive ese calendario, y por eso es la unidad que se programa.
  const asignaciones = await prisma.planAsset.findMany({
    where: {
      organizationId,
      active: true,
      plan: { active: true, triggerType: "METER" },
      asset: EQUIPO_EN_SERVICIO,
    },
    include: {
      // La mano de obra viene por actividad: con frecuencias distintas, el
      // estimado de la orden es la suma de LO QUE ENTRA, no el del servicio
      // completo. Sin esto, un ciclo ligero se proyecta con las horas de uno
      // pesado y la carga del personal sale inflada —y esa cifra decide si
      // contratar—.
      plan: { include: { tasks: { orderBy: { position: "asc" }, include: { labor: true } } } },
      asset: true,
      meter: true,
    },
  });

  for (const asignacion of asignaciones) {
    // `plan` conserva el nombre para no reescribir el resto del cuerpo, pero
    // las fechas y el medidor salen de la asignacion, que es lo que cambia
    // entre un equipo y otro.
    const plan = {
      ...asignacion.plan,
      assetId: asignacion.assetId,
      asset: asignacion.asset,
      meter: asignacion.meter,
      nextDueDate: asignacion.nextDueDate,
      nextDueMeter: asignacion.nextDueMeter,
      lastCompletedAt: asignacion.lastCompletedAt,
      lastGeneratedAt: asignacion.lastGeneratedAt,
    };

    const openExisting = await prisma.workOrder.findFirst({
      where: {
        organizationId,
        planId: plan.id,
        assetId: asignacion.assetId,
        status: { in: ["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
      },
      select: { id: true, number: true },
    });
    if (openExisting) {
      result.skipped += 1;
      result.details.push({ plan: plan.name, reason: `Ya existe ${openExisting.number} abierta` });
      continue;
    }

    const due = siguienteHabil(resolveDueDate(plan), j);
    if (!due) {
      result.skipped += 1;
      // El motivo nombra al equipo y la causa real. Un plan por medidor
      // aplicado a un equipo sin medidor se ve asignado y no genera nunca;
      // decir "sin regla valida" manda a buscar el problema donde no esta.
      const causa =
        plan.triggerType === "METER" && !asignacion.meterId
          ? `${asignacion.asset.code}: el plan es por medidor y este equipo no tiene medidor asignado`
          : plan.triggerType === "METER" && !plan.intervalMeter
            ? `${asignacion.asset.code}: el plan es por medidor pero no tiene intervalo`
            : `${asignacion.asset.code}: sin regla de vencimiento valida`;
      result.details.push({ plan: plan.name, reason: causa });
      continue;
    }

    const triggerDate = addDays(due, -plan.leadTimeDays);
    const limit = addDays(today, horizon);
    if (triggerDate > limit) {
      result.skipped += 1;
      result.details.push({
        plan: plan.name,
        reason: `Fuera de ventana (vence ${due.toISOString().slice(0, 10)})`,
      });
      continue;
    }

    /**
     * Que actividades entran en ESTA ejecucion.
     *
     * No todas van cada vez: el aceite cada mes y el liquido de frenos cada
     * seis. La actividad toca cuando el numero de ejecucion es multiplo de su
     * `cadaCuantas`, y por eso el anidamiento sale gratis —en la sexta entran
     * las de cada 1, cada 2, cada 3 y cada 6, en una sola orden y una sola
     * visita—.
     *
     * Con `cadaCuantas` en 1 —el valor por omision— entran todas siempre, que
     * es el comportamiento de toda la vida.
     */
    const nEjecucion = asignacion.ejecuciones + 1;
    const actividades = tocanEn(plan.tasks, nEjecucion);

    /**
     * Un ciclo donde no toca nada NO genera orden.
     *
     * Pasa cuando las frecuencias no son multiplos entre si: con actividades
     * cada 45 y cada 30 dias la base es 15, y hay ciclos vacios. Emitir una
     * orden sin actividades es exactamente la clase de basura que hace que la
     * gente deje de mirar la bandeja. Se avanza el calendario y el contador, y
     * ya.
     */
    if (!actividades.length) {
      await prisma.planAsset.update({
        where: { id: asignacion.id },
        data: { ejecuciones: nEjecucion, nextDueDate: due },
      });
      result.skipped += 1;
      result.details.push({ plan: plan.name, reason: "ninguna actividad toca en este ciclo" });
      continue;
    }

    if (options.dryRun) {
      result.generated += 1;
      result.details.push({ plan: plan.name, workOrder: "(simulacion)" });
      continue;
    }

    const number = await nextWorkOrderNumber(organizationId);
    const workOrder = await prisma.workOrder.create({
      data: {
        organizationId,
        number,
        title: plan.name,
        description: plan.description,
        maintenanceType: plan.maintenanceType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
        status: plan.assignedToId ? "ASSIGNED" : "OPEN",
        priority: plan.priority,
        assetId: plan.assetId,
        siteId: plan.asset?.siteId ?? null,
        locationId: plan.asset?.locationId ?? null,
        planId: plan.id,
        assignedToId: plan.assignedToId,
        teamId: plan.teamId,
        createdById: options.userId ?? null,
        dueDate: due,
        scheduledStart: triggerDate,
        estimatedHours: horasDe(actividades, plan.estimatedHours),
        requiresShutdown: plan.requiresShutdown,
        procedure: plan.procedure,
        safetyNotes: plan.safetyNotes,
        meterValue: plan.meter?.currentValue ?? null,
        tasks: {
          create: actividades.map((task) => ({
            position: task.position,
            title: task.title,
            description: task.description,
            taskType: task.taskType,
            unit: task.unit,
            minValue: task.minValue,
            maxValue: task.maxValue,
            required: task.required,
            // De que plan salio cada actividad. Al cerrar, esto es lo que
            // decide cual plan avanza: una OT mezclada puede traer actividades
            // de dos planes y el planId del encabezado solo alcanza para uno.
            origen: "PLAN",
            origenPlanId: plan.id,
            planTaskId: task.id,
            maintenanceType: plan.maintenanceType,
          })),
        },
      },
    });

    // Se marca la asignacion, no el plan: el plan sirve a varios equipos y
    // cada uno lleva su propio avance.
    await prisma.planAsset.update({
      where: { id: asignacion.id },
      data: { lastGeneratedAt: new Date(), nextDueDate: due, ejecuciones: nEjecucion },
    });

    await logAudit({
      organizationId,
      userId: options.userId,
      entity: "WorkOrder",
      entityId: workOrder.id,
      action: "AUTO_GENERATED",
      summary: `${number} generada por el plan ${plan.name}`,
    });

    if (plan.assignedToId) {
      await notify({
        organizationId,
        userId: plan.assignedToId,
        title: `Nueva OT preventiva ${number}`,
        body: plan.name,
        link: `/work-orders/${workOrder.id}`,
        tag: number,
      });
    }

    result.generated += 1;
    result.details.push({ plan: plan.name, workOrder: number });
  }

  return result;
}

function resolveDueDate(plan: {
  triggerType: string;
  intervalDays: number | null;
  intervalMeter: number | null;
  nextDueDate: Date | null;
  nextDueMeter: number | null;
  lastCompletedAt: Date | null;
  createdAt: Date;
  meter?: { currentValue: number; dailyAverage: number } | null;
}): Date | null {
  if (plan.triggerType === "CALENDAR") {
    if (plan.nextDueDate) return plan.nextDueDate;
    if (!plan.intervalDays) return null;
    const base = plan.lastCompletedAt ?? plan.createdAt;
    return addDays(base, plan.intervalDays);
  }

  if (plan.triggerType === "METER") {
    const meter = plan.meter;
    if (!meter || !plan.intervalMeter) return null;
    const target = plan.nextDueMeter ?? meter.currentValue + plan.intervalMeter;
    const remaining = target - meter.currentValue;
    if (remaining <= 0) return new Date();
    const rate = meter.dailyAverage > 0 ? meter.dailyAverage : 1;
    return addDays(new Date(), Math.ceil(remaining / rate));
  }

  return null;
}

/** Recalcula el siguiente vencimiento tras cerrar una OT preventiva. */
export async function rollForwardPlan(
  planId: string,
  completedAt: Date,
  meterValue?: number | null,
  assetId?: string | null,
) {
  const plan = await prisma.maintenancePlan.findUnique({
    where: { id: planId },
    select: { id: true, triggerType: true, intervalDays: true, intervalMeter: true },
  });
  if (!plan) return;

  // Avanza la asignacion de ESTE equipo. Un plan que sirve a diez compresores
  // no puede avanzar entero porque se cerro el de uno: los otros nueve siguen
  // con su propia fecha.
  const asignacion = assetId
    ? await prisma.planAsset.findUnique({
        where: { planId_assetId: { planId, assetId } },
        include: { meter: true },
      })
    : null;
  if (!asignacion) return;

  /**
   * Desde donde se cuenta el siguiente: lo decide la organizacion.
   *
   * CIERRE —lo de siempre— cuenta desde que se hizo de verdad. Correcto para
   * trabajo por desgaste: si el engrasado tocaba el 1 y se hizo el 15, el
   * siguiente es 30 dias despues del 15.
   *
   * PROGRAMADO cuenta desde la fecha en que TOCABA, asi que el calendario no
   * se desplaza. Correcto para trabajo anclado al calendario y para quien
   * reporta cumplimiento contra un programa anual.
   *
   * Ninguno de los dos salta actividades: el contador de ejecuciones avanza de
   * uno en uno, asi que un cierre tardio mueve la fecha pero nunca se brinca
   * el ciclo que tocaba.
   */
  const org = await prisma.organization.findUnique({
    where: { id: asignacion.organizationId },
    select: { recalculoPlan: true },
  });
  const desdeProgramado = org?.recalculoPlan === "PROGRAMADO";

  const data: Record<string, unknown> = { lastCompletedAt: completedAt };

  if (plan.triggerType === "CALENDAR" && plan.intervalDays) {
    const ancla = desdeProgramado ? (asignacion.nextDueDate ?? completedAt) : completedAt;
    let siguiente = addDays(ancla, plan.intervalDays);
    // Con PROGRAMADO y un cierre muy tardio la siguiente fecha puede quedar en
    // el pasado. Se adelanta hasta la primera que no ha ocurrido, en vez de
    // dejar un vencimiento que nace vencido y dispara una orden de inmediato.
    let guarda = 0;
    while (desdeProgramado && siguiente <= completedAt && guarda < 400) {
      siguiente = addDays(siguiente, plan.intervalDays);
      guarda += 1;
    }
    data.nextDueDate = siguiente;
  }
  if (plan.triggerType === "METER" && plan.intervalMeter) {
    const base = meterValue ?? asignacion.meter?.currentValue ?? 0;
    data.nextDueMeter = base + plan.intervalMeter;
    const rate = asignacion.meter?.dailyAverage && asignacion.meter.dailyAverage > 0
      ? asignacion.meter.dailyAverage : 1;
    data.nextDueDate = addDays(completedAt, Math.ceil(plan.intervalMeter / rate));
  }

  await prisma.planAsset.update({ where: { id: asignacion.id }, data });
}

/** Agenda proyectada (sin persistir) para la vista de calendario. */
export async function forecastSchedule(organizationId: string, days = 60) {
  // Se proyecta por ASIGNACION, igual que se genera. Recorrer planes daria una
  // sola linea por plan aunque sirva a diez equipos, y con la fecha del plan,
  // que quedo obsoleta cuando el calendario se mudo al equipo.
  // Los planes por CALENDARIO se proyectan actividad por actividad y se
  // agrupan con la misma ventana que usa el generador, para que el calendario
  // prometa las visitas que de verdad van a ocurrir y no una por actividad.
  await sembrarLoQueFalte(organizationId);
  const porActividad = await proyectarActividades(organizationId, days);

  const asignaciones = await prisma.planAsset.findMany({
    // La proyeccion tenia el mismo hueco: pronosticaba trabajo para equipos
    // dados de baja, y esa cifra se usa para planear carga de personal.
    where: {
      organizationId, active: true, asset: EQUIPO_EN_SERVICIO,
      // Solo medidores: el calendario ya salio arriba.
      plan: { active: true, triggerType: "METER" },
    },
    include: {
      plan: {
        select: {
          id: true, name: true, priority: true, maintenanceType: true, triggerType: true,
          intervalDays: true, intervalMeter: true, createdAt: true,
          // Para saber que visitas van a llevar algo y cuales no.
          tasks: { select: { cadaCuantas: true } },
        },
      },
      asset: { select: { id: true, name: true, code: true, categoryId: true } },
      meter: true,
    },
  });

  const plans = asignaciones.map((a) => ({
    ...a.plan,
    // El identificador incluye el equipo: dos compresores del mismo plan son
    // dos eventos distintos en el calendario, no uno repetido.
    id: `${a.plan.id}:${a.assetId}`,
    planId: a.plan.id,
    asset: a.asset,
    meter: a.meter,
    nextDueDate: a.nextDueDate,
    nextDueMeter: a.nextDueMeter,
    lastCompletedAt: a.lastCompletedAt,
    ejecuciones: a.ejecuciones,
  }));

  const horizon = addDays(new Date(), days);
  const events: Array<{
    id: string;
    planId: string;
    title: string;
    asset: string;
    /** El equipo, para poder filtrar la proyeccion igual que las ordenes. */
    assetId: string | null;
    categoryId: string | null;
    date: string;
    priority: string;
    type: string;
    /** Cuantas actividades lleva ESA visita. Con frecuencias distintas, varia. */
    actividades: number;
    /**
     * QUE lleva esa visita.
     *
     * El conteo solo no alcanza: con cada actividad en su propia fecha, la
     * pregunta que se hace quien mira el calendario es "que me toca el mes que
     * entra", no "cuantas cosas". Vacio en el camino de medidores, que todavia
     * proyecta por plan.
     */
    titulos: string[];
    projected: true;
  }> = [];

  for (const plan of plans) {
    let due = resolveDueDate(plan);
    if (!due) continue;
    let guard = 0;
    /**
     * El contador avanza junto con la proyeccion.
     *
     * Sin esto el calendario mostraria una visita cada ciclo aunque no toque
     * ninguna actividad —pasa cuando las frecuencias no son multiplos entre
     * si— y estaria enseñando trabajo que nunca va a ocurrir. El programador
     * salta esos ciclos; la proyeccion tiene que saltarlos igual o las dos
     * dicen cosas distintas sobre lo mismo.
     */
    let n = plan.ejecuciones;
    while (due <= horizon && guard < 40) {
      n += 1;
      const tocan = tocanEn(plan.tasks, n);
      if (!tocan.length) {
        guard += 1;
        const siguiente = avanzar(plan, due);
        if (!siguiente) break;
        due = siguiente;
        continue;
      }
      events.push({
        actividades: tocan.length,
        titulos: [],
        id: `${plan.id}-${due.toISOString()}`,
        planId: plan.planId,
        title: plan.name,
        asset: plan.asset ? `${plan.asset.code} · ${plan.asset.name}` : "—",
        assetId: plan.asset?.id ?? null,
        categoryId: plan.asset?.categoryId ?? null,
        date: due.toISOString(),
        priority: plan.priority,
        type: plan.maintenanceType,
        projected: true,
      });
      const siguiente = avanzar(plan, due);
      if (!siguiente) break;
      due = siguiente;
      guard += 1;
    }
  }

  for (const v of porActividad) {
    events.push({
      actividades: v.actividades.length,
      titulos: v.actividades,
      id: `${v.planId}:${v.assetId}-${v.fecha.toISOString()}`,
      planId: v.planId,
      title: v.planNombre,
      asset: `${v.assetCode} · ${v.assetNombre}`,
      assetId: v.assetId,
      categoryId: v.categoryId,
      date: v.fecha.toISOString(),
      priority: v.priority,
      type: v.maintenanceType,
      projected: true,
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Recorre una fecha al siguiente dia laborable.
 *
 * Un preventivo con vencimiento en domingo o el 25 de diciembre nace vencido:
 * nadie lo va a hacer ese dia, y al dia siguiente ya sale en rojo. Se recorre
 * hacia adelante y no hacia atras porque adelantar un mantenimiento sin que
 * nadie lo pida es cambiar el plan por cuenta propia.
 *
 * El tope de 15 dias evita un ciclo infinito si alguien deja la organizacion
 * sin ningun dia habil configurado.
 */
export function siguienteHabil(fecha: Date | null, j: Parameters<typeof esHabil>[1]): Date | null {
  if (!fecha) return null;
  const d = new Date(fecha);
  for (let i = 0; i < 15; i++) {
    if (esHabil(d, j)) return d;
    d.setDate(d.getDate() + 1);
  }
  return fecha;
}

/**
 * Las horas estimadas de lo que de verdad entra en la orden.
 *
 * Si las actividades declaran su mano de obra, se suman —personas por horas—.
 * Si ninguna la declara, se cae al estimado del plan: es lo que habia antes y
 * sigue siendo mejor que cero. La mezcla se evita a proposito; sumar lo
 * declarado y ademas el estimado del plan contaria dos veces.
 */
function horasDe(
  actividades: Array<{ labor?: Array<{ personas: number; hours: number }> }>,
  estimadoDelPlan: number,
): number {
  const suma = actividades.reduce(
    (t, a) => t + (a.labor ?? []).reduce((h, l) => h + l.personas * l.hours, 0),
    0,
  );
  return suma > 0 ? suma : estimadoDelPlan;
}

/**
 * La fecha del siguiente ciclo. Un solo lugar porque la usan el ciclo normal
 * y el vacio: si se escribieran aparte, un dia dejarian de coincidir y la
 * proyeccion se desplazaria justo en los planes con frecuencias mezcladas.
 */
function avanzar(
  plan: {
    triggerType: string;
    intervalDays: number | null;
    intervalMeter: number | null;
    meter?: { dailyAverage: number } | null;
  },
  desde: Date,
): Date | null {
  if (plan.triggerType === "CALENDAR" && plan.intervalDays) {
    return addDays(desde, plan.intervalDays);
  }
  if (plan.triggerType === "METER" && plan.intervalMeter && plan.meter) {
    const rate = plan.meter.dailyAverage > 0 ? plan.meter.dailyAverage : 1;
    return addDays(desde, Math.ceil(plan.intervalMeter / rate));
  }
  return null;
}

/** Los estados en que una orden todavia esta viva y puede recibir trabajo. */
const ORDEN_ABIERTA = ["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;

/**
 * El camino de los planes POR CALENDARIO: una orden por equipo y plan, con las
 * actividades que le tocan a ESA visita.
 *
 * El cambio de fondo es de quien vence. Antes vencia el PLAN y se preguntaba
 * que actividades le tocaban a esa vuelta, deduciendolo de multiplos de una
 * cadencia base. Ahora vence la ACTIVIDAD, cada una con su fecha, y las que
 * caen cerca se juntan.
 *
 * Tres reglas gobiernan el armado:
 *
 *  - **La ventana adelanta, nunca retrasa.** Si las bujias tocan el 22 y el
 *    aceite el 25, la orden sale el 22 con las dos. Empujar las bujias al 25
 *    seria diferir un mantenimiento, y eso no lo decide el sistema.
 *  - **Una actividad que ya vive en una orden abierta no se vuelve a ofrecer.**
 *    El control es por actividad y no por plan: con fechas propias, dos
 *    actividades del mismo plan pueden estar en momentos distintos y un
 *    candado a nivel plan bloquearia trabajo que si toca.
 *  - **Generar no adelanta el reloj.** El reloj avanza al CERRAR. Si se
 *    adelantara aqui, una orden que nadie termina correria el calendario en
 *    silencio y el mantenimiento se daria por hecho sin haberse hecho.
 */
async function generarPorActividad(
  organizationId: string,
  options: { horizonDays?: number; userId?: string | null; dryRun?: boolean } = {},
): Promise<GenerationResult> {
  const horizon = options.horizonDays ?? 0;
  const today = startOfDay(new Date());
  const result: GenerationResult = { generated: 0, skipped: 0, details: [] };

  const regla = await reglaDeOrganizacion(organizationId, today);
  const j = regla.jornada;

  // Lo primero: que ninguna asignacion se quede sin reloj. Una asignacion sin
  // relojes no genera nada y se ve idéntica a una al corriente.
  await sembrarLoQueFalte(organizationId);

  // Se pide con holgura: la anticipacion de cada plan y la ventana de
  // agrupamiento pueden alcanzar actividades bastante mas lejanas que el
  // horizonte pedido, y filtrarlas despues es barato.
  const maxLead = await prisma.maintenancePlan.aggregate({
    where: { organizationId, active: true, triggerType: "CALENDAR" },
    _max: { leadTimeDays: true },
  });
  const alcance = addDays(
    today,
    horizon + (maxLead._max.leadTimeDays ?? 0) + regla.horizonteDias,
  );

  const pendientes = await actividadesPendientes(organizationId, {
    hasta: alcance,
    triggerType: "CALENDAR",
  });
  if (!pendientes.length) return result;

  // Lo que ya esta en una orden viva no se vuelve a ofrecer.
  const enOrdenAbierta = await prisma.workOrderTask.findMany({
    where: {
      workOrder: { organizationId, status: { in: [...ORDEN_ABIERTA] } },
      liberadaAt: null,
      planTaskId: { in: pendientes.map((p) => p.planTaskId) },
    },
    select: { planTaskId: true, workOrder: { select: { assetId: true, number: true } } },
  });
  const ocupadas = new Map<string, string>();
  for (const t of enOrdenAbierta) {
    ocupadas.set(`${t.planTaskId}:${t.workOrder.assetId ?? ""}`, t.workOrder.number);
  }

  // Agrupadas por equipo y plan. No se mezclan planes en una sola orden: el
  // encabezado lleva UN planId y 23 de 24 asignaciones reales son un equipo
  // con un solo plan, asi que mezclar complicaria el caso raro para nadie.
  const grupos = new Map<string, typeof pendientes>();
  for (const a of pendientes) {
    if (ocupadas.has(`${a.planTaskId}:${a.assetId}`)) {
      result.skipped += 1;
      result.details.push({
        plan: a.planNombre,
        reason: `${a.assetCode} · ${a.titulo}: ya está en ${ocupadas.get(`${a.planTaskId}:${a.assetId}`)}`,
      });
      continue;
    }
    const clave = `${a.assetId}:${a.planId}`;
    const lista = grupos.get(clave);
    if (lista) lista.push(a);
    else grupos.set(clave, [a]);
  }

  const limite = addDays(today, horizon);

  for (const [, actividades] of grupos) {
    // Que actividad DISPARA la orden: la primera cuya fecha, menos la
    // anticipacion de su plan, ya entro en la ventana de este barrido.
    const disparan = actividades.filter(
      (a) => addDays(a.proximaEl, -a.leadTimeDays) <= limite,
    );
    if (!disparan.length) continue;

    const primera = disparan.reduce((m, a) => (a.proximaEl < m.proximaEl ? a : m));
    // La fecha de la orden se recorre al siguiente dia laborable: un
    // vencimiento en domingo nace vencido porque nadie lo va a hacer ese dia.
    const due = siguienteHabil(primera.proximaEl, j) as Date;

    // Y todo lo que caiga dentro de la ventana de agrupamiento se sube a la
    // misma vuelta. Esta es la parte que ahorra el segundo viaje.
    const corte = addDays(primera.proximaEl, regla.horizonteDias);
    const entran = actividades
      .filter((a) => a.proximaEl <= corte)
      .sort((a, b) => a.position - b.position);

    if (options.dryRun) {
      result.generated += 1;
      result.details.push({
        plan: `${primera.planNombre} · ${primera.assetCode}`,
        workOrder: `(simulación, ${entran.length} actividad${entran.length === 1 ? "" : "es"})`,
      });
      continue;
    }

    const plan = await prisma.maintenancePlan.findUnique({
      where: { id: primera.planId },
      select: {
        id: true, name: true, description: true, maintenanceType: true, priority: true,
        assignedToId: true, teamId: true, requiresShutdown: true, procedure: true,
        safetyNotes: true, estimatedHours: true, leadTimeDays: true,
      },
    });
    if (!plan) continue;

    const asset = await prisma.asset.findUnique({
      where: { id: primera.assetId },
      select: { siteId: true, locationId: true },
    });

    const number = await nextWorkOrderNumber(organizationId);
    const horas = entran.reduce((t, a) => t + a.horas, 0);
    const workOrder = await prisma.workOrder.create({
      data: {
        organizationId,
        number,
        title: plan.name,
        description: plan.description,
        maintenanceType: plan.maintenanceType === "INSPECTION" ? "INSPECTION" : "PREVENTIVE",
        status: plan.assignedToId ? "ASSIGNED" : "OPEN",
        priority: plan.priority,
        assetId: primera.assetId,
        siteId: asset?.siteId ?? null,
        locationId: asset?.locationId ?? null,
        planId: plan.id,
        assignedToId: plan.assignedToId,
        teamId: plan.teamId,
        createdById: options.userId ?? null,
        dueDate: due,
        scheduledStart: addDays(due, -plan.leadTimeDays),
        // Las horas salen de la mano de obra de lo que DE VERDAD entra. Si
        // ninguna actividad la declara se cae al estimado del plan, que es lo
        // que habia antes y sigue siendo mejor que cero.
        estimatedHours: horas > 0 ? horas : plan.estimatedHours,
        requiresShutdown: plan.requiresShutdown,
        procedure: plan.procedure,
        safetyNotes: plan.safetyNotes,
        tasks: {
          create: entran.map((a, i) => ({
            position: i,
            title: a.titulo,
            description: a.descripcion,
            taskType: a.taskType,
            unit: a.unit,
            minValue: a.minValue,
            maxValue: a.maxValue,
            required: a.required,
            origen: "PLAN",
            origenPlanId: a.planId,
            planTaskId: a.planTaskId,
            maintenanceType: plan.maintenanceType,
          })),
        },
      },
    });

    await prisma.planAsset.updateMany({
      where: { organizationId, planId: plan.id, assetId: primera.assetId },
      data: { lastGeneratedAt: new Date(), nextDueDate: due },
    });

    await logAudit({
      organizationId,
      userId: options.userId,
      entity: "WorkOrder",
      entityId: workOrder.id,
      action: "AUTO_GENERATED",
      summary: `${number} generada por el plan ${plan.name} con ${entran.length} actividad${
        entran.length === 1 ? "" : "es"
      }`,
    });

    if (plan.assignedToId) {
      await notify({
        organizationId,
        userId: plan.assignedToId,
        title: `Nueva OT preventiva ${number}`,
        body: `${plan.name} · ${primera.assetCode}`,
        link: `/work-orders/${workOrder.id}`,
        tag: number,
      });
    }

    result.generated += 1;
    result.details.push({
      plan: `${plan.name} · ${primera.assetCode}`,
      workOrder: `${number} (${entran.length})`,
    });
  }

  return result;
}

/**
 * Motor de programacion preventiva: los dos caminos.
 *
 * Calendario por actividad y medidor por asignacion. Se corren los dos y se
 * junta el resultado, para que quien lo llama —el cron, el boton de la
 * pantalla, las pruebas— siga viendo una sola cifra.
 */
export async function generateScheduledWorkOrders(
  organizationId: string,
  options: { horizonDays?: number; userId?: string | null; dryRun?: boolean } = {},
): Promise<GenerationResult> {
  const [porActividad, porMedidor] = [
    await generarPorActividad(organizationId, options),
    await generarPorMedidor(organizationId, options),
  ];
  return {
    generated: porActividad.generated + porMedidor.generated,
    skipped: porActividad.skipped + porMedidor.skipped,
    details: [...porActividad.details, ...porMedidor.details],
  };
}
