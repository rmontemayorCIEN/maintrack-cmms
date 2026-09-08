import { prisma } from "./db";
import { nextWorkOrderNumber } from "./numbering";
import { addDays, startOfDay } from "./utils";
import { logAudit, notify } from "./audit";
import { esHabil, jornada } from "./agenda";

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
export async function generateScheduledWorkOrders(
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
      plan: { active: true, triggerType: { in: ["CALENDAR", "METER"] } },
    },
    include: {
      plan: { include: { tasks: { orderBy: { position: "asc" } } } },
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
        estimatedHours: plan.estimatedHours,
        requiresShutdown: plan.requiresShutdown,
        procedure: plan.procedure,
        safetyNotes: plan.safetyNotes,
        meterValue: plan.meter?.currentValue ?? null,
        tasks: {
          create: plan.tasks.map((task) => ({
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
      data: { lastGeneratedAt: new Date(), nextDueDate: due },
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

  const data: Record<string, unknown> = { lastCompletedAt: completedAt };

  if (plan.triggerType === "CALENDAR" && plan.intervalDays) {
    data.nextDueDate = addDays(completedAt, plan.intervalDays);
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
  const asignaciones = await prisma.planAsset.findMany({
    where: { organizationId, active: true, plan: { active: true } },
    include: {
      plan: { select: { id: true, name: true, priority: true, maintenanceType: true, triggerType: true, intervalDays: true, intervalMeter: true, createdAt: true } },
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
    projected: true;
  }> = [];

  for (const plan of plans) {
    let due = resolveDueDate(plan);
    if (!due) continue;
    let guard = 0;
    while (due <= horizon && guard < 40) {
      events.push({
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
      if (plan.triggerType === "CALENDAR" && plan.intervalDays) {
        due = addDays(due, plan.intervalDays);
      } else if (plan.triggerType === "METER" && plan.intervalMeter && plan.meter) {
        const rate = plan.meter.dailyAverage > 0 ? plan.meter.dailyAverage : 1;
        due = addDays(due, Math.ceil(plan.intervalMeter / rate));
      } else break;
      guard += 1;
    }
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
