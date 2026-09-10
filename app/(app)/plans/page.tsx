import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import {
  MAINTENANCE_TYPE_COLORS,
  MAINTENANCE_TYPE_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  TRIGGER_LABELS,
} from "@/lib/constants";
import { dueLabel, formatCurrency, formatNumber } from "@/lib/utils";
import { costearPlan, incluirTareas } from "@/lib/plan-tasks";
import { RunSchedulerButton } from "../calendar/run-scheduler";
import { PlanDialog } from "./plan-dialog";
import { PlanRowActions } from "./plan-actions";
import { GeneradorPlan } from "./generador";
import { consumoIa } from "@/lib/ia/consumo";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { iaConfigurada } from "@/lib/ia/cliente";
import { EnlacesPlan } from "./enlaces-plan";
import { TablaPlanes, type FilaPlan } from "./tabla-planes";
import { vistaGuardada } from "@/lib/vistas";
import { coberturaPreventiva } from "@/lib/cobertura-planes";
import { AlertTriangle, Network } from "lucide-react";

export const metadata = { title: "Planes preventivos" };
export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const user = await requireUser();
  const editable = can(user.role, "plan:write");
  const puedeCrearCatalogos = can(user.role, "settings:write");
  const currency = user.organization.currency;

  // Equipos sin NINGUN plan. La pregunta va del lado del equipo, no del plan:
  // «a este plan que equipos le faltan» no se puede contestar sin equivocarse
  // cuando hay compresores tipo A, B y C en la misma categoria.
  const cobertura = await coberturaPreventiva(user.organizationId);

  const [plans, assets, meters, technicians, especialidades, refacciones, servicios] = await Promise.all([
    prisma.maintenancePlan.findMany({
      where: { organizationId: user.organizationId },
      include: {
        asset: { select: { code: true, name: true } },
        meter: { select: { name: true, unit: true, currentValue: true } },
        _count: { select: { workOrders: true, asignaciones: true } },
        asignaciones: {
          where: { active: true },
          orderBy: { nextDueDate: "asc" },
          select: { nextDueDate: true, lastCompletedAt: true, lastGeneratedAt: true },
        },
        tasks: incluirTareas,
        links: {
          orderBy: { createdAt: "desc" },
          select: { id: true, title: true, url: true, note: true, createdAt: true },
        },
      },
      // El calendario vive en las asignaciones: la fecha que se muestra es la
      // mas proxima de sus equipos, no la del plan, que quedo obsoleta.
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.meter.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true, unit: true, assetId: true, currentValue: true },
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.specialty.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, code: true, name: true, hourlyRate: true },
      orderBy: { code: "asc" },
    }),
    prisma.part.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, code: true, name: true, unit: true, unitCost: true },
      orderBy: { code: "asc" },
    }),
    prisma.externalService.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, code: true, name: true, unit: true, unitCost: true },
      orderBy: { code: "asc" },
    }),
  ]);

  // Los catalogos que alimentan los recursos de cada actividad.
  const opcEspecialidades = especialidades.map((e) => ({
    id: e.id, etiqueta: `${e.code} — ${e.name}`, costo: e.hourlyRate, unidad: "h",
  }));
  const opcRefacciones = refacciones.map((r) => ({
    id: r.id, etiqueta: `${r.code} — ${r.name}`, costo: r.unitCost, unidad: r.unit,
  }));
  const usoIa = await consumoIa(user.organizationId);
  const entitlementIa = iaDeLaOrganizacion(user.organization);
  const puedeRedactarConIa =
    iaConfigurada() && editable && entitlementIa.funciones.includes("PLAN");
  const operacionesRestantes = Math.max(0, entitlementIa.operaciones - usoIa.operaciones);

  const opcServicios = servicios.map((s) => ({
    id: s.id, etiqueta: `${s.code} — ${s.name}`, costo: s.unitCost, unidad: s.unit,
  }));

  /** Convierte un plan guardado al formato que espera el dialogo de edicion. */
  function paraEditar(plan: (typeof plans)[number]) {
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      assetId: plan.assetId,
      maintenanceType: plan.maintenanceType,
      triggerType: plan.triggerType,
      intervalDays: plan.intervalDays,
      intervalMeter: plan.intervalMeter,
      meterId: plan.meterId,
      leadTimeDays: plan.leadTimeDays,
      priority: plan.priority,
      estimatedHours: plan.estimatedHours,
      assignedToId: plan.assignedToId,
      requiresShutdown: plan.requiresShutdown,
      safetyNotes: plan.safetyNotes,
      nextDueDate: plan.nextDueDate ? plan.nextDueDate.toISOString().slice(0, 10) : null,
      tasks: plan.tasks.map((t) => ({
        title: t.title,
        taskType: t.taskType,
        unit: t.unit ?? undefined,
        minValue: t.minValue != null ? String(t.minValue) : undefined,
        maxValue: t.maxValue != null ? String(t.maxValue) : undefined,
        required: t.required,
        /**
         * La frecuencia, en las palabras en que se guardo.
         *
         * Vacio significa "la frecuencia del plan", que es el caso de siempre
         * y por eso es lo que no hay que capturar. Un plan anterior al
         * calendario por actividad no trae `cadaCuanto` y cae ahi solo.
         */
        cadaCuanto: t.cadaCuanto ? String(t.cadaCuanto) : undefined,
        unidadFrecuencia: t.unidadFrecuencia ?? "DIAS",
        labor: t.labor.map((l) => ({
          specialtyId: l.specialtyId, personas: String(l.personas), hours: String(l.hours),
        })),
        parts: t.parts.map((p) => ({ partId: p.partId, quantity: String(p.quantity) })),
        services: t.services.map((s) => ({
          serviceId: s.serviceId, quantity: String(s.quantity), nota: s.nota ?? "",
        })),
      })),
    };
  }

  const activeCount = plans.filter((p) => p.active).length;
  const meterPlans = plans.filter((p) => p.triggerType === "METER").length;

  const vista = vistaGuardada(user.vistasTabla, "planes");

  const filas: FilaPlan[] = plans.map((plan) => {
    const costo = costearPlan(plan.tasks);
    const frecuencia =
      plan.triggerType === "CALENDAR"
        ? `Cada ${plan.intervalDays} dias`
        : plan.triggerType === "METER"
          ? `Cada ${formatNumber(plan.intervalMeter ?? 0, 0)} ${plan.meter?.unit ?? ""}`
          : "Por condición";
    return {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      activo: plan.asset?.name ?? null,
      activoCodigo: plan.asset?.code ?? null,
      maintenanceType: plan.maintenanceType,
      triggerType: plan.triggerType,
      priority: plan.priority,
      frecuencia,
      medidorActual:
        plan.triggerType === "METER" && plan.meter
          ? `Actual ${formatNumber(plan.meter.currentValue, 0)} ${plan.meter.unit}`
          : null,
      // La mas proxima de sus equipos: es lo que le interesa a quien mira la
      // lista —cuando vuelve a tocar este plan— sin importar en cual equipo.
      nextDueDate: plan.asignaciones.find((a) => a.nextDueDate)?.nextDueDate?.toISOString() ?? null,
      lastCompletedAt: plan.asignaciones
        .map((a) => a.lastCompletedAt).filter(Boolean)
        .sort((x, y) => y!.getTime() - x!.getTime())[0]?.toISOString() ?? null,
      lastGeneratedAt: plan.asignaciones
        .map((a) => a.lastGeneratedAt).filter(Boolean)
        .sort((x, y) => y!.getTime() - x!.getTime())[0]?.toISOString() ?? null,
      actividades: plan.tasks.length,
      costoEstimado: costo.total,
      horasEstimadas: costo.horas,
      otGeneradas: plan._count.workOrders,
      requiereParo: plan.requiresShutdown,
      equipos: plan._count.asignaciones,
      intervalDays: plan.intervalDays,
      active: plan.active,
      toleranciaDias: plan.toleranceDays,
      anticipacionDias: plan.leadTimeDays,
      moneda: currency,
      enlaces: plan.links.map((l) => ({
        id: l.id, title: l.title, url: l.url, note: l.note, createdAt: l.createdAt.toISOString(),
      })),
      paraEditar: paraEditar(plan),
    };
  });

  return (
    <>
      <PageHeader
        title="Planes de mantenimiento preventivo"
        description={`${activeCount} planes activos · ${meterPlans} disparados por medidor · el programador genera las ordenes automaticamente.`}
        actions={
          editable ? (
            <>
              <RunSchedulerButton />
              {puedeRedactarConIa ? (
                <GeneradorPlan
                  assets={assets}
                  meters={meters}
                  technicians={technicians}
                  especialidades={opcEspecialidades}
                  refacciones={opcRefacciones}
                  servicios={opcServicios}
                  moneda={currency}
                  puedeCrearCatalogos={puedeCrearCatalogos}
                  operacionesRestantes={operacionesRestantes}
                />
              ) : null}
              <PlanDialog
                assets={assets}
                meters={meters}
                technicians={technicians}
                especialidades={opcEspecialidades}
                refacciones={opcRefacciones}
                servicios={opcServicios}
                moneda={currency}
                puedeCrearCatalogos={puedeCrearCatalogos}
              />
            </>
          ) : null
        }
      />

      {cobertura.sinPlan.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            {cobertura.sinPlan.length} de {cobertura.totalActivos} equipos no tienen ningún plan de mantenimiento
          </p>
          <ul className="mt-1.5 grid gap-0.5">
            {cobertura.porCategoria.slice(0, 6).map((c) => (
              <li key={c.categoria} className="text-xs text-amber-900">
                <b>{c.categoria}</b>: {c.sinPlan} de {c.total} sin plan
              </li>
            ))}
          </ul>
          <Link
            href="/plans/cobertura"
            className="mt-2 inline-block text-xs font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
          >
            Ver cuáles y asignarles su plan
          </Link>
        </div>
      ) : null}

      <div className="mb-3">
        <Link
          href="/plans/cobertura"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Network className="h-3.5 w-3.5" /> Equipos y sus planes
        </Link>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          title="Aun no hay planes"
          description="Cree un plan por calendario (cada N dias) o por medidor (cada N horas, kilometros o ciclos). El sistema generara las ordenes preventivas segun la anticipacion configurada."
        />
      ) : (
        <TablaPlanes
          planes={filas}
          vistaInicial={vista}
          editable={editable}
          assets={assets}
          meters={meters}
          technicians={technicians}
          especialidades={opcEspecialidades}
          refacciones={opcRefacciones}
          servicios={opcServicios}
          moneda={currency}
          puedeCrearCatalogos={puedeCrearCatalogos}
        />
      )}
    </>
  );
}
