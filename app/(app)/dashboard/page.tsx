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
import { assetCostRanking, computeKpis, monthlyTrend } from "@/lib/kpi";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Progress, Stat } from "@/components/ui";
import { CostRankingChart, DonutChart, MixChart, TrendChart } from "@/components/charts/dashboard-charts";
import {
  MAINTENANCE_TYPE_COLORS,
  MAINTENANCE_TYPE_LABELS,
  OPEN_STATUSES,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  WO_STATUS_COLORS,
  WO_STATUS_LABELS,
} from "@/lib/constants";
import { dueLabel, formatCurrency, formatNumber } from "@/lib/utils";
import { ArrowRight, ListChecks } from "lucide-react";
import { puestaEnMarcha } from "@/lib/puesta-en-marcha";

export const metadata = { title: "Panel de control" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const currency = user.organization.currency;

  const [kpis, trend, ranking, upcoming, criticalOpen, alerts, stockParts, pendingRequests] =
    await Promise.all([
      computeKpis(orgId),
      monthlyTrend(orgId, 6),
      assetCostRanking(orgId, 8),
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

  const typeData = Object.entries(kpis.byType).map(([key, value]) => ({
    name: MAINTENANCE_TYPE_LABELS[key] ?? key,
    value,
  }));

  const complianceTone = kpis.reliability.pmCompliance >= 90 ? "good" : kpis.reliability.pmCompliance >= 75 ? "warn" : "bad";
  const availabilityTone = kpis.reliability.availability >= 95 ? "good" : kpis.reliability.availability >= 90 ? "warn" : "bad";

  // Mientras la cuenta no este lista, el panel abre con lo que falta: los
  // indicadores de una cuenta a medio configurar no significan nada todavia.
  const marcha = await puestaEnMarcha(user.organizationId);

  return (
    <>
      <PageHeader
        title={`Hola, ${user.name.split(" ")[0]}`}
        description={`Resumen operativo de ${user.organization.name} — ultimos 90 dias`}
        actions={
          <>
            <LinkButton href="/reports" variant="secondary" size="sm">
              Ver reportes
            </LinkButton>
            <LinkButton href="/work-orders/new" size="sm">
              Nueva orden
            </LinkButton>
          </>
        }
      />

      {!marcha.completa ? (
        <Link
          href="/puesta-en-marcha"
          className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 transition-colors hover:bg-brand-50"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-brand-600">
            <ListChecks className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-900">
              Puesta en marcha al {marcha.porcentaje}%
            </p>
            <p className="text-xs text-brand-800/80">
              {marcha.siguiente
                ? `Sigue: ${marcha.siguiente.titulo}. ${marcha.siguiente.falta}`
                : "Ya casi termina."}
            </p>
            <div className="mt-1.5 max-w-md">
              <Progress value={marcha.porcentaje} tone={marcha.porcentaje >= 60 ? "good" : "warn"} />
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-brand-600" />
        </Link>
      ) : null}

      {(criticalOpen > 0 || alerts.length > 0 || pendingRequests > 0) && (
        <div className="mb-6 grid gap-3 md:grid-cols-3">
          {criticalOpen > 0 && (
            <AlertCard
              href="/work-orders?priority=CRITICAL"
              tone="danger"
              icon={<ShieldAlert className="h-4 w-4" />}
              title={`${criticalOpen} OT criticas abiertas`}
              detail="Requieren atención inmediata"
            />
          )}
          {alerts.length > 0 && (
            <AlertCard
              href="/alerts"
              tone="warning"
              icon={<AlertTriangle className="h-4 w-4" />}
              title={`${alerts.length} alertas predictivas activas`}
              detail="Monitoreo de condición fuera de umbral"
            />
          )}
          {pendingRequests > 0 && (
            <AlertCard
              href="/requests"
              tone="info"
              icon={<CalendarClock className="h-4 w-4" />}
              title={`${pendingRequests} solicitudes por revisar`}
              detail="Pendientes de aprobación"
            />
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Disponibilidad"
          value={`${formatNumber(kpis.reliability.availability, 1)}%`}
          hint={`${formatNumber(kpis.reliability.totalDowntimeMinutes / 60, 1)} h de paro acumulado`}
          tone={availabilityTone}
          icon={<Gauge className="h-4 w-4" />}
        />
        <Stat
          label="Cumplimiento PM"
          value={`${formatNumber(kpis.reliability.pmCompliance, 0)}%`}
          hint="Preventivos cerrados en fecha"
          tone={complianceTone}
          icon={<Wrench className="h-4 w-4" />}
        />
        <Stat
          label="MTTR"
          value={`${formatNumber(kpis.reliability.mttr, 1)} h`}
          hint="Tiempo medio de reparación"
          icon={<Timer className="h-4 w-4" />}
        />
        <Stat
          label="MTBF"
          value={`${formatNumber(kpis.reliability.mtbf, 0)} h`}
          hint="Tiempo medio entre fallas"
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Backlog abierto"
          value={kpis.totals.backlog}
          hint={`${formatNumber(kpis.totals.backlogHours, 0)} h estimadas`}
        />
        <Stat
          label="OT vencidas"
          value={kpis.totals.overdue}
          tone={kpis.totals.overdue > 0 ? "bad" : "good"}
          hint="Fuera de la fecha compromiso"
        />
        <Stat
          label="Trabajo planificado"
          value={`${formatNumber(kpis.reliability.plannedRatio, 0)}%`}
          hint="Meta de clase mundial: 80%"
          tone={kpis.reliability.plannedRatio >= 80 ? "good" : "warn"}
        />
        <Stat
          label="Costo del periodo"
          value={formatCurrency(kpis.costs.totalCost, currency)}
          hint={`MO ${formatCurrency(kpis.costs.laborCost, currency)} · Refacciones ${formatCurrency(kpis.costs.partsCost, currency)}`}
          icon={<CircleDollarSign className="h-4 w-4" />}
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
          <CardHeader title="Distribución por tipo" subtitle="Órdenes del periodo" />
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
          <CardHeader title="Activos con mayor costo" subtitle="Concentración del gasto" />
          <CostRankingChart data={ranking} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
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
                    const due = dueLabel(wo.dueDate);
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
                          <Badge tone={due.tone === "muted" ? "muted" : due.tone}>{due.text}</Badge>
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
                        {alert.severity === "CRITICAL" ? "Critico" : "Alerta"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[0.6875rem] leading-snug text-slate-500">{alert.message}</p>
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

function AlertCard({
  href,
  tone,
  icon,
  title,
  detail,
}: {
  href: string;
  tone: "danger" | "warning" | "info";
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  const tones = {
    danger: "border-red-200 bg-red-50 text-red-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
  };
  return (
    <Link href={href} className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-opacity hover:opacity-90 ${tones[tone]}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/70">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="truncate text-xs opacity-80">{detail}</p>
      </div>
    </Link>
  );
}
