import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Clock,
  Gauge,
  ShieldAlert,
  Timer,
  Wrench,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calcularIndicadores, costoYParoPorActivo, periodoDeLaEmpresa, tendenciaMensual } from "@/lib/indicadores";
import { estadoDeVencimiento } from "@/lib/vencimiento";
import { TarjetaIndicador } from "@/components/tarjeta-indicador";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Progress, Stat } from "@/components/ui";
import { CostRankingChart, DonutChart, MixChart, TrendChart } from "@/components/charts/perezosas";
import {
  MAINTENANCE_TYPE_COLORS,
  MAINTENANCE_TYPE_LABELS,
  OPEN_STATUSES,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  WO_STATUS_COLORS,
  WO_STATUS_LABELS,
} from "@/lib/constants";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { ArrowRight, ListChecks } from "lucide-react";
import { evaluarPuntos } from "@/lib/predictive";

/**
 * Tendencias y desglose de los últimos 90 días: indicadores con su detalle,
 * tendencia mensual, mezcla de mantenimiento, costo por equipo, lo próximo a
 * vencer, alertas y refacciones bajo mínimo.
 *
 * Vivía en el inicio del dueño y repetía lo que el inicio ya dice (vencidas,
 * alertas). Aquí es donde se consulta con calma; el inicio responde qué está
 * mal y qué requiere decisión, y liga a esta pantalla para el detalle.
 */
export async function PanelTendencias() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const currency = user.organization.currency;
  const DIAS = 90;
  const periodo = await periodoDeLaEmpresa(orgId, DIAS);

  const [kpis, trend, ranking, upcoming, criticalOpen, alerts, stockParts, pendingRequests] =
    await Promise.all([
      calcularIndicadores(orgId, periodo),
      tendenciaMensual(orgId, 6),
      costoYParoPorActivo(orgId, periodo, 8),
      prisma.workOrder.findMany({
        where: { organizationId: orgId, status: { in: OPEN_STATUSES } },
        include: {
          asset: { select: { code: true, name: true } },
          assignedTo: { select: { name: true, color: true } },
        },
        orderBy: [{ dueDate: "asc" }],
        take: 8,
      }),
      prisma.workOrder.count({
        where: { organizationId: orgId, status: { in: OPEN_STATUSES }, priority: "CRITICAL" },
      }),
      prisma.predictiveAlert.findMany({
        where: { organizationId: orgId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        include: { asset: { select: { code: true, name: true } } },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 5,
      }),
      // Comparar dos columnas entre si no se expresa con el API de Prisma, y una
      // consulta cruda no seria portable: PostgreSQL pliega los identificadores
      // sin comillas a minusculas y trata `active` como booleano, mientras que
      // SQLite acepta ambas formas. Se filtra en memoria: el catalogo de
      // refacciones de una planta cabe de sobra.
      prisma.part.findMany({
        where: { organizationId: orgId, active: true },
        select: {
          id: true, code: true, name: true,
          quantityOnHand: true, minQuantity: true, unit: true,
        },
        orderBy: { quantityOnHand: "asc" },
        take: 2000,
      }),
      prisma.workRequest.count({ where: { organizationId: orgId, status: "PENDING" } }),
    ]);

  // Bajo minimo, de lo mas critico a lo menos.
  const lowStock = stockParts
    .filter((part) => part.quantityOnHand <= part.minQuantity)
    .sort((a, b) => a.quantityOnHand - a.minQuantity - (b.quantityOnHand - b.minQuantity))
    .slice(0, 5);

  const typeData = Object.entries(kpis.porTipo).map(([key, value]) => ({
    name: MAINTENANCE_TYPE_LABELS[key] ?? key,
    value,
  }));

  const ind = kpis.indicadores;
  // El estado de hoy de cada punto con alerta, no el texto guardado al detectar.
  const vivas = await evaluarPuntos(orgId, alerts.map((a) => a.sensorId).filter(Boolean) as string[]);
  const tonoMinimo = (v: number | null, bueno: number, regular: number) =>
    v === null ? "default" : v >= bueno ? "good" : v >= regular ? "warn" : "bad";


  return (
    <>
      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Tendencias y desglose</h2>
          <p className="text-xs text-slate-500">Últimos {DIAS} días de {user.organization.name}: detalle de cada indicador, gráficas y costos por equipo</p>
        </div>
        <LinkButton href="/reports" variant="secondary" size="sm">Ver reportes</LinkButton>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaIndicador
          indicador={ind.disponibilidad}
          dias={DIAS}
          pista={`${formatNumber(ind.paroNoPlaneado.valor ?? 0, 1)} h de paro no planeado · ${formatNumber(ind.paroTotal.valor ?? 0, 1)} h de paro acumulado`}
          tono={tonoMinimo(ind.disponibilidad.valor, 95, 90)}
          icono={<Gauge className="h-4 w-4" />}
        />
        <TarjetaIndicador
          indicador={ind.cumplimientoPreventivo}
          dias={DIAS}
          etiqueta="Cumplimiento PM"
          decimales={0}
          pista="Programadas terminadas a más tardar el día compromiso"
          tono={tonoMinimo(ind.cumplimientoPreventivo.valor, 90, 75)}
          icono={<Wrench className="h-4 w-4" />}
        />
        <TarjetaIndicador
          indicador={ind.mttr}
          dias={DIAS}
          etiqueta="MTTR"
          pista="Tiempo medio de reparación"
          icono={<Timer className="h-4 w-4" />}
        />
        <TarjetaIndicador
          indicador={ind.mtbf}
          dias={DIAS}
          etiqueta="MTBF"
          decimales={0}
          pista="Tiempo medio entre fallas"
          icono={<Clock className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaIndicador
          indicador={ind.backlog}
          dias={DIAS}
          etiqueta="Backlog abierto"
          pista={`${formatNumber(kpis.totales.backlogHoras, 0)} h estimadas`}
        />
        <Stat
          label="OT vencidas"
          value={kpis.totales.backlogVencido}
          tone={kpis.totales.backlogVencido > 0 ? "bad" : "good"}
          hint="Abiertas con la fecha compromiso ya pasada"
          href="/work-orders?vencidas=1"
        />
        <TarjetaIndicador
          indicador={ind.trabajoPlanificado}
          dias={DIAS}
          decimales={0}
          pista="Meta de clase mundial: 80%"
          tono={ind.trabajoPlanificado.valor === null ? "default" : ind.trabajoPlanificado.valor >= 80 ? "good" : "warn"}
        />
        <TarjetaIndicador
          indicador={ind.costoMantenimiento}
          dias={DIAS}
          moneda={currency}
          etiqueta="Costo del periodo"
          pista={`MO ${formatCurrency(kpis.costos.mano, currency)} · Refacciones ${formatCurrency(kpis.costos.refacciones, currency)}`}
          icono={<CircleDollarSign className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Carga de trabajo y costo"
            subtitle="Órdenes creadas contra completadas por mes"
          />
          <TrendChart data={trend} />
        </Card>
        <Card>
          <CardHeader title="Distribución por tipo" subtitle="Órdenes creadas en el periodo, sin canceladas" />
          <DonutChart data={typeData} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Mezcla preventivo / predictivo / correctivo"
            subtitle="Proporción mensual — una mezcla sana favorece el trabajo planificado"
          />
          <MixChart data={trend} />
        </Card>
        <Card>
          <CardHeader title="Activos con mayor costo" subtitle={`Órdenes terminadas en los últimos ${DIAS} días`} />
          <CostRankingChart data={ranking} />
        </Card>
      </div>

      {/* `grid-cols-[minmax(0,1fr)]`: en el telefono esta rejilla es de una sola
          columna, y una columna implicita se mide por el contenido. Con la tabla
          de abajo adentro, la pista crecia a 620 px y sacaba de lado a toda la
          pantalla. Ver components/tabla-configurable.tsx. */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" padded={false}>
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Proximas órdenes</h3>
              <p className="text-xs text-slate-500">Backlog ordenado por fecha compromiso</p>
            </div>
            <Link href="/work-orders" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
              Ver todas <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="Sin órdenes abiertas" description="Ejecute el programador para generar los preventivos del periodo." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Descripción</th>
                    <th>Tipo</th>
                    <th>Prioridad</th>
                    <th>Estado</th>
                    <th>Vencimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((wo) => {
                    const due = estadoDeVencimiento(wo, { zona: periodo.zonaHoraria });
                    return (
                      <tr key={wo.id}>
                        <td>
                          <Link href={`/work-orders/${wo.id}`} className="font-medium text-brand-600 hover:underline">
                            {wo.number}
                          </Link>
                        </td>
                        <td>
                          <p className="font-medium text-slate-800">{wo.title}</p>
                          <p className="text-xs text-slate-500">
                            {wo.asset ? `${wo.asset.code} · ${wo.asset.name}` : "Sin activo"}
                          </p>
                        </td>
                        <td>
                          <Badge className={MAINTENANCE_TYPE_COLORS[wo.maintenanceType]}>
                            {MAINTENANCE_TYPE_LABELS[wo.maintenanceType]}
                          </Badge>
                        </td>
                        <td>
                          <Badge className={PRIORITY_COLORS[wo.priority]}>{PRIORITY_LABELS[wo.priority]}</Badge>
                        </td>
                        <td>
                          <Badge className={WO_STATUS_COLORS[wo.status]}>{WO_STATUS_LABELS[wo.status]}</Badge>
                        </td>
                        <td>
                          <Badge tone={due.tono}>{due.texto}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader
              title="Alertas predictivas"
              subtitle="Condición fuera de parámetro"
              action={
                <Link href="/alerts" className="text-xs font-medium text-brand-600 hover:underline">
                  Ver
                </Link>
              }
            />
            {alerts.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">Todos los equipos dentro de parametro</p>
            ) : (
              <ul className="grid gap-2.5">
                {alerts.map((alert) => (
                  <li key={alert.id} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-slate-800">{alert.asset.name}</p>
                      <Badge tone={alert.severity === "CRITICAL" ? "danger" : "warning"}>
                        {alert.severity === "CRITICAL" ? "Crítica" : "Advertencia"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[0.6875rem] leading-snug text-slate-500">
                      {(alert.sensorId && vivas.get(alert.sensorId)?.resumen) || alert.message}
                      {alert.normalizadaEl ? " Normalizada: falta validar." : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Refacciones bajo mínimo"
              subtitle="Requieren reposición"
              action={
                <Link href="/inventory" className="text-xs font-medium text-brand-600 hover:underline">
                  Almacén
                </Link>
              }
            />
            {lowStock.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">Inventario en niveles adecuados</p>
            ) : (
              <ul className="grid gap-3">
                {lowStock.map((part) => (
                  <li key={part.id}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{part.name}</span>
                      <span className="tabular-nums text-slate-500">
                        {formatNumber(part.quantityOnHand, 0)} / {formatNumber(part.minQuantity, 0)} {part.unit}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <Progress
                        value={part.minQuantity ? (part.quantityOnHand / part.minQuantity) * 100 : 0}
                        tone={part.quantityOnHand === 0 ? "bad" : "warn"}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

