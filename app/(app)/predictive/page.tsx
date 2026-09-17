import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { evaluarPunto, MIN_LECTURAS_PROYECCION, type EstadoPunto } from "@/lib/predictive";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Progress, Stat } from "@/components/ui";
import { SENSOR_TYPE_LABELS } from "@/lib/constants";
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
    trend: evaluarPunto(
      sensor.readings.map((r) => ({ value: r.value, readingAt: r.readingAt })),
      sensor,
    ),
  }));

  const critical = evaluations.filter((e) => e.trend.estado === "CRITICO").length;
  const warning = evaluations.filter((e) => e.trend.estado === "ADVERTENCIA").length;
  // Solo los que aun no cruzan el critico y tienen proyeccion valida.
  const projected = evaluations.filter((e) => e.trend.cruceCritico.dias !== null);
  const nearest = projected.sort((a, b) => (a.trend.cruceCritico.dias ?? 0) - (b.trend.cruceCritico.dias ?? 0))[0];

  return (
    <>
      <PageHeader
        title="Mantenimiento predictivo"
        description={`Monitoreo de condición por punto. El estado sale de la última lectura contra sus umbrales; la tendencia y la fecha estimada de cruce, de una regresión lineal con al menos ${MIN_LECTURAS_PROYECCION} lecturas.`}
        actions={editable ? <SensorDialog assets={assets} /> : null}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Puntos monitoreados" value={sensors.length} hint="Sensores activos" />
        <Stat label="En advertencia" value={warning} tone={warning ? "warn" : "good"} hint="Sobre umbral de advertencia" />
        <Stat label="Umbral crítico superado" value={critical} tone={critical ? "bad" : "good"} hint="Requieren intervención" />
        <Stat
          label="Cruce crítico más próximo"
          value={nearest?.trend.cruceCritico.dias != null ? `${nearest.trend.cruceCritico.dias} d` : "—"}
          hint={nearest ? `${nearest.sensor.asset.code} · ${nearest.sensor.name}` : "Sin cruces proyectados"}
          tone={nearest && (nearest.trend.cruceCritico.dias ?? 99) < 15 ? "bad" : "default"}
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
                      <Badge tone={TONO_ESTADO[trend.estado]}>{trend.etiquetaEstado}</Badge>
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
                    <span>Consumo del umbral crítico</span>
                    <span className="tabular-nums">{formatNumber(usage, 0)}%</span>
                  </div>
                  <Progress value={usage} tone={usage >= 100 ? "bad" : usage >= 75 ? "warn" : "good"} />
                </div>

                <p className={`mt-3 text-xs font-medium ${trend.estado === "CRITICO" ? "text-red-700" : trend.estado === "ADVERTENCIA" ? "text-amber-700" : "text-slate-600"}`}>
                  {trend.resumen}
                </p>
                <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-2.5 sm:grid-cols-2">
                  <Metric
                    label="Tendencia"
                    value={trend.etiquetaTendencia}
                    hint={trend.tendencia === "SIN_DATOS" ? trend.etiquetaConfianza : `${trend.pendientePorDia >= 0 ? "+" : ""}${formatNumber(trend.pendientePorDia, 3)} ${sensor.unit}/día hacia el umbral · ${trend.etiquetaConfianza.toLowerCase()} · ${trend.lecturasUsadas} lecturas`}
                  />
                  <Metric label="Cruce de advertencia" value={trend.cruceAdvertencia.texto} hint={sensor.warningThreshold != null ? `Umbral ${formatNumber(sensor.warningThreshold, 2)} ${sensor.unit}` : ""} />
                  <Metric label="Cruce crítico" value={trend.cruceCritico.texto} hint={sensor.criticalThreshold != null ? `Umbral ${formatNumber(sensor.criticalThreshold, 2)} ${sensor.unit}` : ""} />
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

const TONO_ESTADO: Record<EstadoPunto, "success" | "warning" | "danger" | "muted"> = {
  NORMAL: "success",
  ADVERTENCIA: "warning",
  CRITICO: "danger",
  SIN_DATOS: "muted",
};

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xs font-semibold text-slate-800">{value}</p>
      <p className="text-[0.625rem] text-slate-400">{hint}</p>
    </div>
  );
}
