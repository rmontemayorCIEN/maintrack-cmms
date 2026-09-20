import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, Gauge } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { verCostos } from "@/lib/pantallas";
import { catalogosDePlanes } from "@/lib/planes-datos";
import { incluirTareas } from "@/lib/plan-tasks";
import { MAINTENANCE_TYPE_LABELS, PRIORITY_LABELS, WO_STATUS_LABELS } from "@/lib/constants";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { PasarRegistros } from "@/components/paso-registros";
import { Plegable } from "@/components/plegable";
import { PlanDialog } from "../plan-dialog";
import { PlanRowActions } from "../plan-actions";
import { EquiposDelPlan } from "../equipos-del-plan";
import { EnlacesPlan } from "../enlaces-plan";
import { planParaEditar } from "../para-editar";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const plan = await prisma.maintenancePlan.findFirst({ where: { id, organizationId: user.organizationId }, select: { name: true } });
  return { title: plan?.name ?? "Plan preventivo" };
}

/**
 * El expediente de un plan preventivo: qué dice, a qué equipos se aplica, con
 * qué recursos y cómo le ha ido.
 *
 * Antes esta dirección rebotaba a la lista filtrada, así que las ligas de los
 * avisos y de la puesta en marcha llegaban a una lista, y para saber si el
 * plan se estaba cumpliendo había que ir a órdenes y filtrar a mano.
 */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const editable = can(user.role, "plan:write");
  const zona = user.organization.timezone;
  const moneda = user.organization.currency;

  const plan = await prisma.maintenancePlan.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      asset: { select: { id: true, code: true, name: true } },
      meter: { select: { name: true, unit: true, currentValue: true } },
      tasks: incluirTareas,
      links: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, url: true, note: true, createdAt: true } },
      asignaciones: {
        orderBy: [{ active: "desc" }, { nextDueDate: "asc" }],
        select: {
          id: true, nextDueDate: true, nextDueMeter: true, lastCompletedAt: true, lastGeneratedAt: true, ejecuciones: true, active: true,
          asset: { select: { id: true, code: true, name: true, criticality: true } },
          meter: { select: { name: true, unit: true, currentValue: true, proyeccionSuspendida: true } },
        },
      },
    },
  });
  if (!plan) notFound();

  const ordenes = await prisma.workOrder.findMany({
    where: { organizationId: user.organizationId, planId: plan.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true, number: true, status: true, dueDate: true, completedAt: true, closedAt: true, actualHours: true, totalCost: true,
      asset: { select: { code: true } },
    },
  });
  const cerradas = await prisma.workOrder.findMany({
    where: { organizationId: user.organizationId, planId: plan.id, status: { in: ["COMPLETED", "CLOSED"] }, completedAt: { not: null } },
    select: { dueDate: true, completedAt: true, actualHours: true, totalCost: true },
  });
  const aTiempo = cerradas.filter((o) => !o.dueDate || (o.completedAt && o.completedAt <= o.dueDate)).length;
  const cumplimiento = cerradas.length ? Math.round((aTiempo / cerradas.length) * 100) : null;
  const horaPromedio = cerradas.length ? cerradas.reduce((s, o) => s + o.actualHours, 0) / cerradas.length : null;
  const costoTotal = cerradas.reduce((s, o) => s + o.totalCost, 0);
  const catalogos = await catalogosDePlanes(user.organizationId);
  const responsable = plan.assignedToId ? catalogos.tecnicos.find((t) => t.id === plan.assignedToId) ?? null : null;
  const porMedidor = plan.triggerType === "METER";
  // El medidor es de cada equipo; el del encabezado solo existe en planes viejos.
  const medidor = plan.meter ?? plan.asignaciones.find((a) => a.meter)?.meter ?? null;
  const proxima = plan.asignaciones.filter((a) => a.active && a.nextDueDate).map((a) => a.nextDueDate!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return (
    <>
      <PageHeader
        title={plan.name}
        breadcrumb={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/plans" className="inline-flex items-center gap-1 hover:text-brand-600">
              <ArrowLeft className="h-3 w-3" /> Planes preventivos
            </Link>
            <PasarRegistros base="/plans" id={plan.id} />
          </span>
        }
        description={plan.description ?? undefined}
        actions={
          editable ? (
            <>
              <PlanDialog
                assets={catalogos.activos}
                meters={catalogos.medidores}
                technicians={catalogos.tecnicos}
                especialidades={catalogos.opcEspecialidades}
                refacciones={catalogos.opcRefacciones}
                servicios={catalogos.opcServicios}
                moneda={moneda}
                puedeCrearCatalogos={can(user.role, "settings:write")}
                plan={planParaEditar(plan)}
              />
              <PlanRowActions planId={plan.id} active={plan.active} />
            </>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Estado" value={plan.active ? "Activo" : "Pausado"} tone={plan.active ? "good" : "warn"} hint={MAINTENANCE_TYPE_LABELS[plan.maintenanceType] ?? plan.maintenanceType} />
        <Stat
          label={porMedidor ? "Cada" : "Frecuencia"}
          value={porMedidor ? `${formatNumber(plan.intervalMeter ?? 0, 0)} ${medidor?.unit ?? "unidades"}` : plan.intervalDays ? `Cada ${plan.intervalDays} días` : "Sin frecuencia"}
          hint={`${plan.tasks.length} actividad(es) · ${formatNumber(plan.estimatedHours, 1)} h estimadas`}
        />
        <Stat label="Equipos" value={plan.asignaciones.filter((a) => a.active).length} hint={proxima ? `Próxima: ${formatDate(proxima, zona)}` : porMedidor ? "Por lectura del medidor" : "Sin fecha programada"} />
        <Stat
          label="Cumplimiento"
          value={cumplimiento === null ? "—" : `${cumplimiento} %`}
          tone={cumplimiento === null ? undefined : cumplimiento >= 90 ? "good" : cumplimiento >= 70 ? "warn" : "bad"}
          hint={cerradas.length ? `${aTiempo} de ${cerradas.length} órdenes a tiempo` : "Todavía sin órdenes cerradas"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader title="Equipos del plan" subtitle="A qué equipos se aplica, cuándo les toca y cuándo se hizo por última vez." />
            <div className="table-wrap">
              <table className="data w-full text-sm">
                <thead><tr><th>Equipo</th><th>Próxima</th><th>Última ejecución</th><th className="text-right">Ejecuciones</th><th>Estado</th></tr></thead>
                <tbody>
                  {plan.asignaciones.map((a) => (
                    <tr key={a.id} className={a.active ? undefined : "opacity-60"}>
                      <td>
                        <Link href={`/assets/${a.asset.id}`} className="font-medium text-brand-600 hover:underline">{a.asset.code}</Link> · {a.asset.name}
                        {a.asset.criticality === "A" ? <Badge tone="danger" className="ml-1.5">Crítico</Badge> : null}
                      </td>
                      <td>
                        {porMedidor
                          ? a.nextDueMeter !== null
                            ? `${formatNumber(a.nextDueMeter, 0)} ${a.meter?.unit ?? medidor?.unit ?? ""}${a.meter ? ` · van ${formatNumber(a.meter.currentValue, 0)}` : ""}`
                            : "Sin referencia del medidor"
                          : a.nextDueDate ? formatDate(a.nextDueDate, zona) : "Sin fecha"}
                      </td>
                      <td>{a.lastCompletedAt ? formatDate(a.lastCompletedAt, zona) : "Nunca"}</td>
                      <td className="text-right tabular-nums">{a.ejecuciones}</td>
                      <td>{a.active ? "Activo" : "Fuera del plan"}</td>
                    </tr>
                  ))}
                  {plan.asignaciones.length === 0 ? <tr><td colSpan={5} className="text-slate-500">Este plan todavía no se aplica a ningún equipo.</td></tr> : null}
                </tbody>
              </table>
            </div>
            {editable ? (
              <div className="mt-3">
                <EquiposDelPlan
                  planId={plan.id}
                  nombre={plan.name}
                  intervaloDias={plan.intervalDays}
                  porMedidor={porMedidor}
                  editable={editable}
                  activos={catalogos.activos}
                />
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Actividades" subtitle="Lo que se hace en cada visita, con sus recursos." />
            <ol className="grid gap-2">
              {plan.tasks.map((t, i) => (
                <li key={t.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-900">{i + 1}. {t.title}{t.required ? "" : " (opcional)"}</p>
                  {t.description ? <p className="mt-0.5 text-xs text-slate-600">{t.description}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {t.taskType === "MEASUREMENT" ? `Medición en ${t.unit ?? "—"}${t.minValue !== null || t.maxValue !== null ? ` · entre ${t.minValue ?? "—"} y ${t.maxValue ?? "—"}` : ""}` : "Verificación"}
                    {t.cadaCuanto ? ` · cada ${t.cadaCuanto} ${(t.unidadFrecuencia ?? "DIAS").toLowerCase()}` : ""}
                  </p>
                  {t.labor.length || t.parts.length || t.services.length ? (
                    <ul className="mt-2 grid gap-0.5 text-xs text-slate-600">
                      {t.labor.map((l) => <li key={l.id}>· {l.personas} × {l.specialty?.name ?? "Especialidad"} — {formatNumber(l.hours, 1)} h</li>)}
                      {t.parts.map((p) => <li key={p.id}>· {formatNumber(p.quantity, 2)} {p.part?.unit ?? ""} de {p.part?.code} · {p.part?.name}</li>)}
                      {t.services.map((s) => <li key={s.id}>· {s.service?.name ?? "Servicio"}{s.nota ? ` — ${s.nota}` : ""}</li>)}
                    </ul>
                  ) : null}
                </li>
              ))}
              {plan.tasks.length === 0 ? <li className="text-sm text-slate-500">Este plan todavía no tiene actividades.</li> : null}
            </ol>
          </Card>

          <Card>
            <CardHeader title="Órdenes que ha generado" subtitle={cerradas.length ? `${cerradas.length} cerradas · ${formatNumber(horaPromedio ?? 0, 1)} h en promedio` : "Todavía no genera órdenes."} />
            {ordenes.length ? (
              <div className="table-wrap">
                <table className="data w-full text-sm">
                  <thead><tr><th>Folio</th><th>Equipo</th><th>Estado</th><th>Para</th><th>Terminada</th>{verCostos(user.role) ? <th className="text-right">Costo</th> : null}</tr></thead>
                  <tbody>
                    {ordenes.map((o) => {
                      const tarde = o.dueDate && o.completedAt && o.completedAt > o.dueDate;
                      return (
                        <tr key={o.id}>
                          <td><Link href={`/work-orders/${o.id}`} className="font-medium text-brand-600 hover:underline">{o.number}</Link></td>
                          <td>{o.asset?.code ?? "—"}</td>
                          <td><Badge tone={o.status === "CLOSED" ? "success" : o.status === "IN_PROGRESS" ? "warning" : "muted"}>{WO_STATUS_LABELS[o.status] ?? o.status}</Badge></td>
                          <td>{o.dueDate ? formatDate(o.dueDate, zona) : "—"}</td>
                          <td className={tarde ? "text-amber-700" : undefined}>{o.completedAt ? `${formatDate(o.completedAt, zona)}${tarde ? " · tarde" : ""}` : "—"}</td>
                          {verCostos(user.role) ? <td className="text-right tabular-nums">{formatCurrency(o.totalCost, moneda)}</td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-slate-500">Cuando toque su fecha, el sistema generará la orden y aparecerá aquí.</p>}
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader title="Ficha" />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Tipo</dt><dd>{MAINTENANCE_TYPE_LABELS[plan.maintenanceType] ?? plan.maintenanceType}</dd>
              <dt className="text-slate-500">Prioridad</dt><dd>{PRIORITY_LABELS[plan.priority] ?? plan.priority}</dd>
              <dt className="text-slate-500">Disparo</dt>
              <dd className="inline-flex items-center gap-1">{porMedidor ? <><Gauge className="h-3.5 w-3.5 text-slate-400" /> Por medidor</> : <><CalendarClock className="h-3.5 w-3.5 text-slate-400" /> Por calendario</>}</dd>
              {porMedidor && medidor ? (<><dt className="text-slate-500">Medidor</dt><dd>{medidor.name ?? "Medidor"} · {formatNumber(medidor.currentValue, 0)} {medidor.unit}</dd></>) : null}
              <dt className="text-slate-500">Responsable</dt><dd>{responsable?.name ?? "Sin asignar"}</dd>
              <dt className="text-slate-500">Aviso previo</dt><dd>{plan.leadTimeDays} día(s)</dd>
              <dt className="text-slate-500">Tolerancia</dt><dd>{plan.toleranceDays} día(s)</dd>
              <dt className="text-slate-500">Requiere paro</dt><dd>{plan.requiresShutdown ? "Sí" : "No"}</dd>
              {verCostos(user.role) ? (<><dt className="text-slate-500">Costo acumulado</dt><dd className="tabular-nums">{formatCurrency(costoTotal, moneda)}</dd></>) : null}
              <dt className="text-slate-500">Creado</dt><dd>{formatDateTime(plan.createdAt, zona)}</dd>
            </dl>
          </Card>

          {plan.procedure || plan.safetyNotes ? (
            <Card>
              <CardHeader title="Procedimiento y seguridad" />
              {plan.safetyNotes ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{plan.safetyNotes}</p> : null}
              {plan.procedure ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{plan.procedure}</p> : null}
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Documentos y enlaces" subtitle="Manuales, fichas técnicas o videos del fabricante." />
            <Plegable titulo="Ver enlaces del plan">
              <EnlacesPlan planId={plan.id} nombre={plan.name} enlaces={plan.links.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))} editable={editable} />
            </Plegable>
          </Card>
        </div>
      </div>
    </>
  );
}
