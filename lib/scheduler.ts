import { prisma } from "./db";
import { nextWorkOrderNumber } from "./numbering";
import { addDays, startOfDay } from "./utils";
import { logAudit, notify } from "./audit";

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

  const plans = await prisma.maintenancePlan.findMany({
    where: { organizationId, active: true, triggerType: { in: ["CALENDAR", "METER"] } },
    include: { tasks: { orderBy: { position: "asc" } }, asset: true, meter: true },
  });

  for (const plan of plans) {
    if (!plan.assetId) {
      result.skipped += 1;
      result.details.push({ plan: plan.name, reason: "Plan sin activo asignado" });
      continue;
    }

    const openExisting = await prisma.workOrder.findFirst({
      where: {
        organizationId,
        planId: plan.id,
        status: { in: ["DRAFT", "OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] },
      },
      select: { id: true, number: true },
    });
    if (openExisting) {
      result.skipped += 1;
      result.details.push({ plan: plan.name, reason: `Ya existe ${openExisting.number} abierta` });
      continue;
    }

    const due = resolveDueDate(plan);
    if (!due) {
      result.skipped += 1;
      result.details.push({ plan: plan.name, reason: "Sin regla de vencimiento valida" });
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

    await prisma.maintenancePlan.update({
      where: { id: plan.id },
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
export async function rollForwardPlan(planId: string, completedAt: Date, meterValue?: number | null) {
  const plan = await prisma.maintenancePlan.findUnique({
    where: { id: planId },
    include: { meter: true },
  });
  if (!plan) return;

  const data: Record<string, unknown> = { lastCompletedAt: completedAt };

  if (plan.triggerType === "CALENDAR" && plan.intervalDays) {
    data.nextDueDate = addDays(completedAt, plan.intervalDays);
  }
  if (plan.triggerType === "METER" && plan.intervalMeter) {
    const base = meterValue ?? plan.meter?.currentValue ?? 0;
    data.nextDueMeter = base + plan.intervalMeter;
    const rate = plan.meter?.dailyAverage && plan.meter.dailyAverage > 0 ? plan.meter.dailyAverage : 1;
    data.nextDueDate = addDays(completedAt, Math.ceil(plan.intervalMeter / rate));
  }

  await prisma.maintenancePlan.update({ where: { id: planId }, data });
}

/** Agenda proyectada (sin persistir) para la vista de calendario. */
export async function forecastSchedule(organizationId: string, days = 60) {
  const plans = await prisma.maintenancePlan.findMany({
    where: { organizationId, active: true },
    include: { asset: { select: { name: true, code: true } }, meter: true },
  });

  const horizon = addDays(new Date(), days);
  const events: Array<{
    id: string;
    planId: string;
    title: string;
    asset: string;
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
        planId: plan.id,
        title: plan.name,
        asset: plan.asset ? `${plan.asset.code} · ${plan.asset.name}` : "—",
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
