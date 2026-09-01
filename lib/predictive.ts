import { prisma } from "./db";
import { nextWorkOrderNumber } from "./numbering";
import { logAudit, notify } from "./audit";

export type SensorEvaluation = {
  status: "NORMAL" | "WARNING" | "CRITICAL";
  slope: number;
  projectedFailureAt: Date | null;
  daysToThreshold: number | null;
  confidence: number;
};

/** Clasifica una lectura contra los umbrales del sensor. */
export function classify(
  value: number,
  sensor: { warningThreshold: number | null; criticalThreshold: number | null; direction: string },
): "NORMAL" | "WARNING" | "CRITICAL" {
  const above = sensor.direction !== "BELOW";
  const { warningThreshold: warn, criticalThreshold: crit } = sensor;
  if (above) {
    if (crit !== null && value >= crit) return "CRITICAL";
    if (warn !== null && value >= warn) return "WARNING";
  } else {
    if (crit !== null && value <= crit) return "CRITICAL";
    if (warn !== null && value <= warn) return "WARNING";
  }
  return "NORMAL";
}

/**
 * Regresion lineal simple sobre las ultimas lecturas para estimar la tendencia
 * y proyectar cuando se alcanzara el umbral critico (vida util remanente).
 * Devuelve un R^2 como medida de confianza de la proyeccion.
 */
export function analyzeTrend(
  readings: Array<{ value: number; readingAt: Date }>,
  sensor: { criticalThreshold: number | null; warningThreshold: number | null; direction: string },
): SensorEvaluation {
  const points = [...readings].sort((a, b) => a.readingAt.getTime() - b.readingAt.getTime());
  const latest = points.at(-1);
  const status = latest ? classify(latest.value, sensor) : "NORMAL";

  if (points.length < 4) {
    return { status, slope: 0, projectedFailureAt: null, daysToThreshold: null, confidence: 0 };
  }

  const t0 = points[0].readingAt.getTime();
  const xs = points.map((p) => (p.readingAt.getTime() - t0) / 86_400_000); // dias
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den; // unidades por dia
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i];
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const confidence = ssTot === 0 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

  const target = sensor.criticalThreshold ?? sensor.warningThreshold;
  let daysToThreshold: number | null = null;
  let projectedFailureAt: Date | null = null;

  if (target !== null && slope !== 0) {
    const currentX = xs[n - 1];
    const targetX = (target - intercept) / slope;
    const delta = targetX - currentX;
    const heading = sensor.direction === "BELOW" ? slope < 0 : slope > 0;
    if (heading && delta > 0 && delta < 3650) {
      daysToThreshold = Math.round(delta);
      projectedFailureAt = new Date(Date.now() + delta * 86_400_000);
    }
  }

  return { status, slope, projectedFailureAt, daysToThreshold, confidence };
}

/**
 * Ingesta de lectura de condicion: guarda el dato, reevalua la tendencia y,
 * si procede, abre una alerta y una OT predictiva.
 */
export async function ingestSensorReading(params: {
  organizationId: string;
  sensorId: string;
  value: number;
  readingAt?: Date;
  source?: string;
  userId?: string | null;
  autoWorkOrder?: boolean;
}) {
  const sensor = await prisma.sensor.findFirst({
    where: { id: params.sensorId, organizationId: params.organizationId },
    include: { asset: true },
  });
  if (!sensor) throw new Error("Sensor no encontrado");

  const readingAt = params.readingAt ?? new Date();
  const status = classify(params.value, sensor);

  await prisma.sensorReading.create({
    data: {
      organizationId: params.organizationId,
      sensorId: sensor.id,
      value: params.value,
      status,
      readingAt,
      source: params.source ?? "IOT",
    },
  });

  await prisma.sensor.update({
    where: { id: sensor.id },
    data: { lastValue: params.value, lastStatus: status, lastReadingAt: readingAt },
  });

  const history = await prisma.sensorReading.findMany({
    where: { sensorId: sensor.id },
    orderBy: { readingAt: "desc" },
    take: 40,
    select: { value: true, readingAt: true },
  });
  const trend = analyzeTrend(history, sensor);

  let alertId: string | null = null;
  let workOrderNumber: string | null = null;

  const needsAlert =
    status !== "NORMAL" ||
    (trend.daysToThreshold !== null && trend.daysToThreshold <= 30 && trend.confidence >= 0.6);

  /** Abre la OT predictiva y avisa a los supervisores. */
  async function openPredictiveWorkOrder(alertDbId: string, message: string) {
    const number = await nextWorkOrderNumber(params.organizationId);
    const wo = await prisma.workOrder.create({
      data: {
        organizationId: params.organizationId,
        number,
        title: `Intervencion predictiva: ${sensor!.asset.name}`,
        description: message,
        maintenanceType: "PREDICTIVE",
        status: "OPEN",
        priority: sensor!.asset.criticality === "A" ? "CRITICAL" : "HIGH",
        assetId: sensor!.assetId,
        siteId: sensor!.asset.siteId,
        locationId: sensor!.asset.locationId,
        dueDate: trend.projectedFailureAt ?? new Date(Date.now() + 3 * 86_400_000),
        estimatedHours: 3,
        createdById: params.userId ?? null,
      },
    });
    await prisma.predictiveAlert.update({
      where: { id: alertDbId },
      data: { workOrderId: wo.id },
    });

    const supervisors = await prisma.user.findMany({
      where: {
        organizationId: params.organizationId,
        role: { in: ["OWNER", "ADMIN", "SUPERVISOR"] },
        active: true,
      },
      select: { id: true },
    });
    await Promise.all(
      supervisors.map((s) =>
        notify({
          organizationId: params.organizationId,
          userId: s.id,
          title: `Alerta critica: ${sensor!.asset.name}`,
          body: message,
          link: `/work-orders/${wo.id}`,
          kind: "CRITICAL",
        }),
      ),
    );
    return number;
  }

  if (needsAlert) {
    const existing = await prisma.predictiveAlert.findFirst({
      where: { sensorId: sensor.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    });

    const severity = status === "CRITICAL" ? "CRITICAL" : "WARNING";
    const message =
      status === "NORMAL"
        ? `Tendencia ascendente: se estima alcanzar el umbral en ${trend.daysToThreshold} dias (R2 ${(trend.confidence * 100).toFixed(0)}%).`
        : `Lectura ${params.value} ${sensor.unit} fuera de umbral (${severity === "CRITICAL" ? sensor.criticalThreshold : sensor.warningThreshold} ${sensor.unit}).`;

    if (existing) {
      await prisma.predictiveAlert.update({
        where: { id: existing.id },
        data: {
          severity,
          value: params.value,
          message,
          trendSlope: trend.slope,
          projectedFailureAt: trend.projectedFailureAt,
        },
      });
      alertId = existing.id;

      // Escalamiento: la alerta ya existia pero acaba de volverse critica.
      if (
        params.autoWorkOrder !== false &&
        severity === "CRITICAL" &&
        !existing.workOrderId
      ) {
        workOrderNumber = await openPredictiveWorkOrder(existing.id, message);
        await logAudit({
          organizationId: params.organizationId,
          userId: params.userId,
          entity: "PredictiveAlert",
          entityId: existing.id,
          action: "ESCALATED",
          summary: message,
        });
      }
    } else {
      const alert = await prisma.predictiveAlert.create({
        data: {
          organizationId: params.organizationId,
          sensorId: sensor.id,
          assetId: sensor.assetId,
          severity,
          title: `${sensor.name} — ${sensor.asset.name}`,
          message,
          value: params.value,
          threshold: severity === "CRITICAL" ? sensor.criticalThreshold : sensor.warningThreshold,
          trendSlope: trend.slope,
          projectedFailureAt: trend.projectedFailureAt,
        },
      });
      alertId = alert.id;

      // Una alerta critica abre automaticamente una OT predictiva.
      if (params.autoWorkOrder !== false && severity === "CRITICAL") {
        workOrderNumber = await openPredictiveWorkOrder(alert.id, message);
      }

      await logAudit({
        organizationId: params.organizationId,
        userId: params.userId,
        entity: "PredictiveAlert",
        entityId: alert.id,
        action: "CREATED",
        summary: message,
      });
    }
  }

  return { status, trend, alertId, workOrderNumber };
}

/** Indice de salud 0-100 del activo a partir del estado de sus sensores. */
export function healthScore(sensors: Array<{ lastStatus: string }>) {
  if (!sensors.length) return 100;
  const penalty = sensors.reduce((sum, s) => {
    if (s.lastStatus === "CRITICAL") return sum + 45;
    if (s.lastStatus === "WARNING") return sum + 18;
    return sum;
  }, 0);
  return Math.max(0, Math.round(100 - penalty / sensors.length));
}
