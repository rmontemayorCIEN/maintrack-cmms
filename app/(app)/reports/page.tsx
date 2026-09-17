import { costoDeMaterialPorTipo } from "@/lib/material-por-actividad";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calcularIndicadores, costoYParoPorActivo, periodoDeLaEmpresa, tendenciaMensual } from "@/lib/indicadores";
import { PERIODOS_INDICADORES, describirPeriodo, diasDeParametro, fechaHoraEnZona } from "@/lib/periodos";
import { TarjetaIndicador } from "@/components/tarjeta-indicador";
import { Badge, Card, CardHeader, PageHeader, Progress, Stat } from "@/components/ui";
import { CostRankingChart, DonutChart, MixChart, TrendChart } from "@/components/charts/dashboard-charts";
import {
  CRITICALITY_COLORS,
  CRITICALITY_LABELS,
  MAINTENANCE_TYPE_COLORS,
  MAINTENANCE_TYPE_LABELS,
  PRIORITY_LABELS,
} from "@/lib/constants";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { agruparPorCodigo, fallasCodificadas } from "@/lib/fallas";

export const metadata = { title: "Reportes" };
export const dynamic = "force-dynamic";


export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const days = diasDeParametro(params.days);
  const currency = user.organization.currency;
  const orgId = user.organizationId;
  const periodo = await periodoDeLaEmpresa(orgId, days);

  const [kpis, trend, ranking, byTechnician, failureCodes, backlogAging, materialPorTipo] = await Promise.all([
    calcularIndicadores(orgId, periodo),
    tendenciaMensual(orgId, 12),
    costoYParoPorActivo(orgId, periodo, 10),
    prisma.workOrderLabor.groupBy({
      by: ["userId"],
      where: { workOrder: { organizationId: orgId, status: { not: "CANCELLED" } }, workedAt: { gte: periodo.desde, lt: periodo.hasta } },
      _sum: { hours: true, cost: true },
      _count: { _all: true },
    }),
    // Pasa por fallasCodificadas y no por un groupBy directo: ese contaba
    // cualquier OT con codigo, incluidos preventivos codificados por error, y
    // el Pareto no coincidia con el analisis de recurrencia.
    fallasCodificadas(orgId, periodo.desde, periodo.hasta).then(agruparPorCodigo),
    prisma.workOrder.findMany({
      where: { organizationId: orgId, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } },
      select: { id: true, createdAt: true, priority: true, estimatedHours: true },
    }),
    costoDeMaterialPorTipo(orgId, periodo.desde, periodo.hasta),
  ]);

  const [technicians, codes] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: byTechnician.map((row) => row.userId) } },
      select: { id: true, name: true, color: true, hourlyRate: true },
    }),
    prisma.failureCode.findMany({
      where: { id: { in: failureCodes.map((row) => row.failureCodeId) } },
    }),
  ]);

  const ind = kpis.indicadores;
  const typeData = Object.entries(kpis.porTipo).map(([key, value]) => ({
    name: MAINTENANCE_TYPE_LABELS[key] ?? key,
    value,
  }));
  const priorityData = Object.entries(kpis.porPrioridad).map(([key, value]) => ({
    name: PRIORITY_LABELS[key] ?? key,
    value,
  }));

  // Antiguedad del backlog: cuanto tiempo llevan abiertas las ordenes.
  const now = Date.now();
  const buckets = [
    { label: "0-7 días", min: 0, max: 7 },
    { label: "8-30 días", min: 8, max: 30 },
    { label: "31-90 días", min: 31, max: 90 },
    { label: "Mas de 90", min: 91, max: Infinity },
  ].map((bucket) => {
    const items = backlogAging.filter((wo) => {
      const age = Math.floor((now - wo.createdAt.getTime()) / 86_400_000);
      return age >= bucket.min && age <= bucket.max;
    });
    return {
      ...bucket,
      count: items.length,
      hours: items.reduce((sum, wo) => sum + wo.estimatedHours, 0),
    };
  });
  const backlogTotal = backlogAging.length || 1;

  const paretoTotal = ranking.reduce((sum, row) => sum + row.costo, 0) || 1;
  let cumulative = 0;

  return (
    <>
      <PageHeader
        title="Reportes e indicadores"
        description={`Análisis de confiabilidad y costos — ${describirPeriodo(periodo)} · ${periodo.zonaHoraria} · actualizado ${fechaHoraEnZona(kpis.actualizadoEl, periodo.zonaHoraria)}`}
        actions={
          <div className="flex gap-1">
            {Object.entries(PERIODOS_INDICADORES).map(([d, label]) => ({ days: Number(d), label })).map((period) => (
              <Link
                key={period.days}
                href={`/reports?days=${period.days}`}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                  days === period.days
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {period.label}
              </Link>
            ))}
          </div>
        }
      />

      <p className="mb-4 text-xs text-slate-500">
        Cada tarjeta abre su fórmula y los registros que la forman. Las mismas cifras salen en el Panel de control y en el Diagnóstico IA.{" "}
        <Link href={`/indicadores?dias=${days}`} className="font-medium text-brand-600 hover:underline">Ver cómo se calcula cada indicador</Link>
      </p>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Confiabilidad</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TarjetaIndicador indicador={ind.mttr} dias={days} etiqueta="MTTR" decimales={2} pista="Tiempo medio de reparación" />
          <TarjetaIndicador indicador={ind.mtbf} dias={days} etiqueta="MTBF" decimales={0} pista="Tiempo medio entre fallas" />
          <TarjetaIndicador
            indicador={ind.disponibilidad}
            dias={days}
            decimales={2}
            pista="Descuenta solo el paro no planeado"
            tono={ind.disponibilidad.valor !== null && ind.disponibilidad.valor >= 95 ? "good" : "warn"}
          />
          <TarjetaIndicador
            indicador={ind.cumplimientoPreventivo}
            dias={days}
            etiqueta="Cumplimiento PM"
            tono={ind.cumplimientoPreventivo.valor !== null && ind.cumplimientoPreventivo.valor >= 90 ? "good" : "warn"}
            pista="Meta: 90%"
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TarjetaIndicador indicador={ind.tiempoRespuesta} dias={days} pista="De creación a inicio, órdenes de falla" />
          <Stat
            label="Precisión de estimación"
            value={kpis.precisionEstimacion === null ? "—" : `${formatNumber(kpis.precisionEstimacion, 0)}%`}
            hint="Horas estimadas vs reales, órdenes terminadas"
          />
          <TarjetaIndicador
            indicador={ind.paroNoPlaneado}
            dias={days}
            pista={`Además ${formatNumber(ind.paroPlaneado.valor ?? 0, 1)} h de paro planeado`}
            tono={(ind.paroNoPlaneado.valor ?? 0) > 0 ? "warn" : "good"}
          />
          <TarjetaIndicador
            indicador={ind.trabajoPlanificado}
            dias={days}
            tono={ind.trabajoPlanificado.valor !== null && ind.trabajoPlanificado.valor >= 80 ? "good" : "warn"}
            pista="Meta clase mundial: 80%"
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Costos</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TarjetaIndicador indicador={ind.costoMantenimiento} dias={days} moneda={currency} etiqueta="Costo total" pista="Órdenes terminadas en el periodo" />
          <Stat label="Mano de obra" value={formatCurrency(kpis.costos.mano, currency)} />
          <Stat label="Refacciones" value={formatCurrency(kpis.costos.refacciones, currency)} />
          <Stat label="Servicios externos" value={formatCurrency(kpis.costos.servicios, currency)} />
          <Stat
            label="Costo por OT"
            value={formatCurrency(kpis.totales.ordenesTerminadas ? kpis.costos.total / kpis.totales.ordenesTerminadas : 0, currency)}
            hint={`${kpis.totales.ordenesTerminadas} órdenes terminadas`}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Tendencia de 12 meses" subtitle="Carga de trabajo y costo mensual" />
          <TrendChart data={trend} />
        </Card>
        <Card>
          <CardHeader title="Distribución por tipo" />
          <DonutChart data={typeData} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Evolución de la mezcla de mantenimiento" subtitle="Objetivo: reducir la proporcion correctiva" />
          <MixChart data={trend} />
        </Card>
        <Card>
          <CardHeader title="Distribución por prioridad" />
          <DonutChart data={priorityData} />
        </Card>
      </div>

      {materialPorTipo.length ? (
        <div className="mt-4">
          <Card>
            <CardHeader
              title="Costo de material por tipo de mantenimiento"
              subtitle="Se atribuye a la ACTIVIDAD que consumió la refacción, no al tipo del encabezado: una orden puede traer el preventivo del mes y una falla en el mismo viaje."
            />
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th className="text-right">Costo de material</th>
                    <th className="text-right">Atribuido por actividad</th>
                    <th className="text-right">Sin actividad (va por el tipo de la orden)</th>
                  </tr>
                </thead>
                <tbody>
                  {materialPorTipo.map((m) => (
                    <tr key={m.tipo}>
                      <td>
                        <Badge className={MAINTENANCE_TYPE_COLORS[m.tipo]}>{MAINTENANCE_TYPE_LABELS[m.tipo] ?? m.tipo}</Badge>
                      </td>
                      <td className="text-right tabular-nums">{formatCurrency(m.costo, currency)}</td>
                      <td className="text-right tabular-nums text-slate-600">{formatCurrency(m.deLaActividad, currency)}</td>
                      <td className="text-right tabular-nums text-slate-500">{formatCurrency(m.delEncabezado, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}

      {/* `grid-cols-[minmax(0,1fr)]`: en el telefono es una sola columna, y una
          columna implicita se mide por el contenido —las tablas de aqui abajo la
          inflaban y sacaban de lado la pantalla completa. */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Pareto de activos por costo"
            subtitle="Concentracion del gasto de mantenimiento (regla 80/20)"
          />
          <CostRankingChart data={ranking} />
          <div className="mt-3 table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Activo</th>
                  <th>Crit.</th>
                  <th className="text-right">OT</th>
                  <th className="text-right">Paro</th>
                  <th className="text-right">Costo</th>
                  <th className="text-right">% acum.</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((row) => {
                  cumulative += row.costo;
                  return (
                    <tr key={row.assetId}>
                      <td className="max-w-40 truncate text-xs">
                        <Link href={`/assets/${row.assetId}`} className="text-brand-600 hover:underline">
                          {row.code}
                        </Link>
                        <span className="ml-1 text-slate-500">{row.name}</span>
                      </td>
                      <td>
                        <Badge className={CRITICALITY_COLORS[row.criticality]}>{row.criticality}</Badge>
                      </td>
                      <td className="text-right tabular-nums text-xs">{row.ordenes}</td>
                      <td className="text-right tabular-nums text-xs">{formatNumber(row.paroHoras, 1)} h</td>
                      <td className="text-right tabular-nums text-xs">{formatCurrency(row.costo, currency)}</td>
                      <td className="text-right tabular-nums text-xs text-slate-500">
                        {formatNumber((cumulative / paretoTotal) * 100, 0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Antiguedad del backlog" subtitle="Órdenes abiertas por rango de edad" />
            <ul className="grid gap-3">
              {buckets.map((bucket) => (
                <li key={bucket.label}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{bucket.label}</span>
                    <span className="tabular-nums text-slate-500">
                      {bucket.count} OT · {formatNumber(bucket.hours, 0)} h
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Progress
                      value={(bucket.count / backlogTotal) * 100}
                      tone={bucket.min > 30 ? "bad" : bucket.min > 7 ? "warn" : "good"}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card padded={false}>
            <div className="px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Productividad por técnico</h3>
              <p className="text-xs text-slate-500">Horas cargadas en el periodo</p>
            </div>
            {byTechnician.length === 0 ? (
              <p className="px-5 pb-6 text-center text-xs text-slate-400">Sin horas registradas</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Técnico</th>
                      <th className="text-right">OT</th>
                      <th className="text-right">Horas</th>
                      <th className="text-right">Costo MO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byTechnician
                      .sort((a, b) => (b._sum.hours ?? 0) - (a._sum.hours ?? 0))
                      .map((row) => {
                        const tech = technicians.find((t) => t.id === row.userId);
                        return (
                          <tr key={row.userId}>
                            <td className="text-xs text-slate-700">{tech?.name ?? "—"}</td>
                            <td className="text-right tabular-nums text-xs">{row._count._all}</td>
                            <td className="text-right tabular-nums text-xs">{formatNumber(row._sum.hours ?? 0, 1)}</td>
                            <td className="text-right tabular-nums text-xs">
                              {formatCurrency(row._sum.cost ?? 0, currency)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Análisis de modos de falla</h3>
              <p className="text-xs text-slate-500">Códigos de falla registrados al cierre</p>
            </div>
            {failureCodes.length === 0 ? (
              <p className="px-5 pb-6 text-center text-xs text-slate-400">
                Sin cierres codificados en el periodo
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th className="text-right">Eventos</th>
                      <th className="text-right">Paro</th>
                      <th className="text-right">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failureCodes.map((row) => {
                      const code = codes.find((c) => c.id === row.failureCodeId);
                      return (
                        <tr key={row.failureCodeId}>
                          <td className="text-xs text-slate-700">
                            <span className="font-medium">{code?.code}</span>{" "}
                            <span className="text-slate-500">{code?.description}</span>
                          </td>
                          <td className="text-right tabular-nums text-xs">{row.eventos}</td>
                          <td className="text-right tabular-nums text-xs">
                            {formatNumber(row.minutosParo / 60, 1)} h
                          </td>
                          <td className="text-right tabular-nums text-xs">
                            {formatCurrency(row.costo, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
