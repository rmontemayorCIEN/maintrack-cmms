import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { analyzeTrend } from "@/lib/predictive";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Progress, Stat } from "@/components/ui";
import { SENSOR_STATUS_COLORS, SENSOR_TYPE_LABELS } from "@/lib/constants";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { SensorSparkline } from "@/components/charts/dashboard-charts";
import { SensorDialog } from "./sensor-dialog";
import { ReadingForm } from "./reading-form";

export const metadata = { title: "Mantenimiento predictivo" };
export const dynamic = "force-dynamic";

export default async function PredictivePage() {
  const user = await requireUser();
  const editable = can(user.role, "predictive:write");

  const [sensors, assets] = await Promise.all([
    prisma.sensor.findMany({
      where: { organizationId: user.organizationId, active: true },
      include: {
        asset: { select: { id: true, code: true, name: true, criticality: true } },
        readings: { orderBy: { readingAt: "desc" }, take: 40 },
      },
      orderBy: [{ lastStatus: "desc" }, { name: "asc" }],
    }),
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const evaluations = sensors.map((sensor) => ({
    sensor,
    trend: analyzeTrend(
      sensor.readings.map((r) => ({ value: r.value, readingAt: r.readingAt })),
      sensor,
    ),
  }));

  const critical = evaluations.filter((e) => e.sensor.lastStatus === "CRITICAL").length;
  const warning = evaluations.filter((e) => e.sensor.lastStatus === "WARNING").length;
  const projected = evaluations.filter((e) => e.trend.daysToThreshold !== null);
  const nearest = projected.sort((a, b) => (a.trend.daysToThreshold ?? 0) - (b.trend.daysToThreshold ?? 0))[0];

  return (
    <>
      <PageHeader
        title="Mantenimiento predictivo"
        description="Monitoreo de condición por sensor. Cada lectura se compara contra umbrales y se proyecta la tendencia por regresión lineal para estimar la vida útil remanente."
        actions={editable ? <SensorDialog assets={assets} /> : null}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Puntos monitoreados" value={sensors.length} hint="Sensores activos" />
        <Stat label="En alerta" value={warning} tone={warning ? "warn" : "good"} hint="Sobre umbral de advertencia" />
        <Stat label="En estado crítico" value={critical} tone={critical ? "bad" : "good"} hint="Requieren intervención" />
        <Stat
          label="Falla mas próxima"
          value={nearest?.trend.daysToThreshold != null ? `${nearest.trend.daysToThreshold} d` : "—"}
          hint={nearest ? `${nearest.sensor.asset.code} · ${nearest.sensor.name}` : "Sin tendencias adversas"}
          tone={nearest && (nearest.trend.daysToThreshold ?? 99) < 15 ? "bad" : "default"}
        />
      </div>

      {sensors.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Sin puntos de monitoreo"
            description="Registre sensores de vibración, temperatura, corriente, presión o análisis de aceite para habilitar el análisis predictivo."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {evaluations.map(({ sensor, trend }) => {
            const series = [...sensor.readings]
              .reverse()
              .map((r) => ({
                t: new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" }).format(r.readingAt),
                value: r.value,
              }));
            const threshold = sensor.criticalThreshold ?? sensor.warningThreshold ?? 0;
            const usage = threshold ? Math.min(100, ((sensor.lastValue ?? 0) / threshold) * 100) : 0;

            return (
              <Card key={sensor.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {sensor.name}
                      <Badge className={SENSOR_STATUS_COLORS[sensor.lastStatus]}>
                        {sensor.lastStatus === "NORMAL" ? "Normal" : sensor.lastStatus === "WARNING" ? "Alerta" : "Critico"}
                      </Badge>
                    </span>
                  }
                  subtitle={
                    <Link href={`/assets/${sensor.asset.id}`} className="hover:text-brand-600">
                      {sensor.asset.code} · {sensor.asset.name} — {SENSOR_TYPE_LABELS[sensor.sensorType]}
                    </Link>
                  }
                  action={
                    <div className="text-right">
                      <p className="text-lg font-semibold tabular-nums text-slate-900">
                        {formatNumber(sensor.lastValue ?? 0, 2)} <span className="text-xs text-slate-400">{sensor.unit}</span>
                      </p>
                      <p className="text-[0.625rem] text-slate-400">{formatDateTime(sensor.lastReadingAt)}</p>
                    </div>
                  }
                />

                <SensorSparkline
                  data={series}
                  warning={sensor.warningThreshold}
                  critical={sensor.criticalThreshold}
                />

                <div className="mt-3 grid gap-2">
                  <div className="flex items-center justify-between text-[0.6875rem] text-slate-500">
                    <span>Consumo del umbral critico</span>
                    <span className="tabular-nums">{formatNumber(usage, 0)}%</span>
                  </div>
                  <Progress value={usage} tone={usage >= 100 ? "bad" : usage >= 75 ? "warn" : "good"} />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-center">
                  <Metric
                    label="Tendencia"
                    value={`${trend.slope >= 0 ? "+" : ""}${formatNumber(trend.slope, 3)}`}
                    hint={`${sensor.unit}/dia`}
                  />
                  <Metric
                    label="Vida remanente"
                    value={trend.daysToThreshold != null ? `${trend.daysToThreshold} d` : "—"}
                    hint={trend.projectedFailureAt ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(trend.projectedFailureAt) : "estable"}
                  />
                  <Metric
                    label="Confianza"
                    value={`${formatNumber(trend.confidence * 100, 0)}%`}
                    hint="R² del ajuste"
                  />
                </div>

                <div className="mt-3">
                  <ReadingForm sensorId={sensor.id} unit={sensor.unit} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-slate-800">{value}</p>
      <p className="text-[0.625rem] text-slate-400">{hint}</p>
    </div>
  );
}
