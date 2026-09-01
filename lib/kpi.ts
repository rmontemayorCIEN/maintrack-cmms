import { prisma } from "./db";
import { OPEN_STATUSES } from "./constants";

export type KpiRange = { from: Date; to: Date };

export function defaultRange(days = 90): KpiRange {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from, to };
}

/**
 * Indicadores estandar de mantenimiento.
 *  - MTTR  = horas de reparacion / numero de reparaciones correctivas
 *  - MTBF  = horas de operacion disponibles / numero de fallas
 *  - Disponibilidad = (tiempo calendario - paro) / tiempo calendario
 *  - Cumplimiento PM = OT preventivas cerradas a tiempo / preventivas programadas
 */
export async function computeKpis(organizationId: string, range: KpiRange = defaultRange()) {
  const [workOrders, assets, downtimes] = await Promise.all([
    prisma.workOrder.findMany({
      where: { organizationId, createdAt: { gte: range.from, lte: range.to } },
      select: {
        id: true,
        maintenanceType: true,
        status: true,
        priority: true,
        createdAt: true,
        dueDate: true,
        startedAt: true,
        completedAt: true,
        downtimeMinutes: true,
        actualHours: true,
        estimatedHours: true,
        laborCost: true,
        partsCost: true,
        serviceCost: true,
        otherCost: true,
        totalCost: true,
        assetId: true,
      },
    }),
    prisma.asset.findMany({
      where: { organizationId, active: true },
      select: { id: true, status: true, criticality: true },
    }),
    prisma.downtimeEvent.findMany({
      where: { asset: { organizationId }, startedAt: { gte: range.from } },
      select: { minutes: true, planned: true, assetId: true },
    }),
  ]);

  const closed = workOrders.filter((w) => w.completedAt);
  const corrective = closed.filter((w) => w.maintenanceType === "CORRECTIVE");
  const preventive = workOrders.filter((w) => w.maintenanceType === "PREVENTIVE");
  const preventiveDone = preventive.filter((w) => w.completedAt);
  const preventiveOnTime = preventiveDone.filter(
    (w) => !w.dueDate || (w.completedAt && w.completedAt <= w.dueDate),
  );

  const repairHours = corrective.reduce((sum, w) => sum + (w.actualHours || 0), 0);
  const mttr = corrective.length ? repairHours / corrective.length : 0;

  const spanHours = Math.max(1, (range.to.getTime() - range.from.getTime()) / 3_600_000);
  const assetCount = Math.max(1, assets.length);
  const failureCount = Math.max(1, corrective.length);
  const totalDowntimeMin = downtimes.reduce((s, d) => s + d.minutes, 0);
  const mtbf = (spanHours * assetCount - totalDowntimeMin / 60) / failureCount;

  const calendarMinutes = spanHours * 60 * assetCount;
  const availability = Math.max(
    0,
    Math.min(100, ((calendarMinutes - totalDowntimeMin) / calendarMinutes) * 100),
  );

  const pmCompliance = preventive.length
    ? (preventiveOnTime.length / preventive.length) * 100
    : 100;

  const backlog = workOrders.filter((w) => OPEN_STATUSES.includes(w.status));
  const now = new Date();
  const overdue = backlog.filter((w) => w.dueDate && w.dueDate < now);
  const backlogHours = backlog.reduce((s, w) => s + (w.estimatedHours || 0), 0);

  const responseTimes = closed
    .filter((w) => w.startedAt)
    .map((w) => (w.startedAt!.getTime() - w.createdAt.getTime()) / 3_600_000);
  const avgResponseHours = responseTimes.length
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : 0;

  const laborCost = workOrders.reduce((s, w) => s + w.laborCost, 0);
  const partsCost = workOrders.reduce((s, w) => s + w.partsCost, 0);
  const serviceCost = workOrders.reduce((s, w) => s + w.serviceCost, 0);
  const otherCost = workOrders.reduce((s, w) => s + w.otherCost, 0);
  const totalCost = laborCost + partsCost + serviceCost + otherCost;

  const plannedWork = closed.filter((w) => w.maintenanceType !== "CORRECTIVE").length;
  const plannedRatio = closed.length ? (plannedWork / closed.length) * 100 : 0;

  const wrenchTime = closed.reduce((s, w) => s + (w.actualHours || 0), 0);
  const estimateAccuracy = (() => {
    const withBoth = closed.filter((w) => w.estimatedHours > 0 && w.actualHours > 0);
    if (!withBoth.length) return 100;
    const ratios = withBoth.map((w) => Math.min(w.estimatedHours, w.actualHours) / Math.max(w.estimatedHours, w.actualHours));
    return (ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100;
  })();

  return {
    range,
    totals: {
      workOrders: workOrders.length,
      completed: closed.length,
      backlog: backlog.length,
      overdue: overdue.length,
      backlogHours,
      assets: assets.length,
      assetsDown: assets.filter((a) => a.status === "DOWN").length,
      criticalAssets: assets.filter((a) => a.criticality === "A").length,
    },
    reliability: {
      mttr,
      mtbf,
      availability,
      pmCompliance,
      plannedRatio,
      avgResponseHours,
      estimateAccuracy,
      totalDowntimeMinutes: totalDowntimeMin,
      unplannedDowntimeMinutes: downtimes.filter((d) => !d.planned).reduce((s, d) => s + d.minutes, 0),
      wrenchTime,
    },
    costs: { laborCost, partsCost, serviceCost, otherCost, totalCost },
    byType: countBy(workOrders, (w) => w.maintenanceType),
    byStatus: countBy(workOrders, (w) => w.status),
    byPriority: countBy(workOrders, (w) => w.priority),
  };
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const k = key(item);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

/** Serie mensual de OT creadas / completadas y costo, para graficas de tendencia. */
export async function monthlyTrend(organizationId: string, months = 6) {
  const from = new Date();
  from.setMonth(from.getMonth() - (months - 1));
  from.setDate(1);
  from.setHours(0, 0, 0, 0);

  const workOrders = await prisma.workOrder.findMany({
    where: { organizationId, createdAt: { gte: from } },
    select: {
      createdAt: true,
      completedAt: true,
      totalCost: true,
      maintenanceType: true,
      downtimeMinutes: true,
    },
  });

  const buckets: Record<string, {
    month: string;
    creadas: number;
    completadas: number;
    preventivo: number;
    correctivo: number;
    predictivo: number;
    costo: number;
    paroHoras: number;
  }> = {};

  for (let i = 0; i < months; i++) {
    const date = new Date(from);
    date.setMonth(from.getMonth() + i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    buckets[key] = {
      month: new Intl.DateTimeFormat("es-MX", { month: "short" }).format(date),
      creadas: 0,
      completadas: 0,
      preventivo: 0,
      correctivo: 0,
      predictivo: 0,
      costo: 0,
      paroHoras: 0,
    };
  }

  const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  for (const wo of workOrders) {
    const bucket = buckets[keyOf(wo.createdAt)];
    if (bucket) {
      bucket.creadas += 1;
      bucket.costo += wo.totalCost;
      bucket.paroHoras += wo.downtimeMinutes / 60;
      if (wo.maintenanceType === "PREVENTIVE") bucket.preventivo += 1;
      if (wo.maintenanceType === "CORRECTIVE") bucket.correctivo += 1;
      if (wo.maintenanceType === "PREDICTIVE") bucket.predictivo += 1;
    }
    if (wo.completedAt) {
      const done = buckets[keyOf(wo.completedAt)];
      if (done) done.completadas += 1;
    }
  }

  return Object.values(buckets).map((b) => ({
    ...b,
    costo: Math.round(b.costo),
    paroHoras: Math.round(b.paroHoras * 10) / 10,
  }));
}

/** Ranking de activos por costo y paro acumulado (regla 80/20). */
export async function assetCostRanking(organizationId: string, limit = 8) {
  const rows = await prisma.workOrder.groupBy({
    by: ["assetId"],
    where: { organizationId, assetId: { not: null } },
    _sum: { totalCost: true, downtimeMinutes: true },
    _count: { _all: true },
  });

  const sorted = rows
    .sort((a, b) => (b._sum.totalCost ?? 0) - (a._sum.totalCost ?? 0))
    .slice(0, limit);

  const assets = await prisma.asset.findMany({
    where: { id: { in: sorted.map((r) => r.assetId!) } },
    select: { id: true, name: true, code: true, criticality: true },
  });

  return sorted.map((row) => {
    const asset = assets.find((a) => a.id === row.assetId);
    return {
      assetId: row.assetId!,
      name: asset?.name ?? "Sin activo",
      code: asset?.code ?? "—",
      criticality: asset?.criticality ?? "C",
      costo: Math.round(row._sum.totalCost ?? 0),
      paroHoras: Math.round(((row._sum.downtimeMinutes ?? 0) / 60) * 10) / 10,
      ordenes: row._count._all,
    };
  });
}
