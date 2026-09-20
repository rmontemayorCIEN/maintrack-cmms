import Link from "next/link";
import { can } from "@/lib/rbac";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Avatar, Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import {
  MAINTENANCE_TYPE_COLORS,
  MAINTENANCE_TYPE_LABELS,
  OPEN_STATUSES,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  WO_STATUS_COLORS,
  WO_STATUS_LABELS,
} from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { estadoDeVencimiento, filtroDeVencidas } from "@/lib/vencimiento";
import { zonaDeLaEmpresa } from "@/lib/indicadores";
import { WorkOrderFilters } from "./filters";
import { TablaOrdenes, type FilaOrden } from "./tabla-ordenes";
import { vistaGuardada } from "@/lib/vistas";
import { verCostos } from "@/lib/pantallas";
import { contiene } from "@/lib/busqueda-texto";

export const metadata = { title: "Órdenes de trabajo" };
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | undefined>>;

export default async function WorkOrdersPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const params = await searchParams;
  const orgId = user.organizationId;
  const zona = await zonaDeLaEmpresa(orgId);
  // «Vencidas» (desde el Panel): abiertas con el dia compromiso ya pasado en la
  // zona de la empresa. Se acota en la base a compromisos anteriores a manana y
  // se decide el dia exacto con la misma regla que pinta la etiqueta.
  const soloVencidas = params.vencidas === "1";
  // Los accesos del inicio y de la barra del teléfono llegan con nombres en
  // español; se aceptan junto con los de siempre.
  const estado = params.estado ?? params.status;
  const prioridad = params.prioridad ?? params.priority;
  const mias = params.mias === "1";
  const sinResponsable = params.sinResponsable === "1";
  const conCostos = verCostos(user.role);

  const where = {
    organizationId: orgId,
    ...(estado ? { status: estado } : {}),
    ...(params.scope === "open" || sinResponsable || (mias && !estado) ? { status: { in: OPEN_STATUSES } } : {}),
    // El criterio de «vencida» vive en lib/vencimiento y lo comparten el
    // inicio y esta lista: antes cada uno usaba el suyo y daban cifras
    // distintas para la misma pregunta.
    ...(soloVencidas ? filtroDeVencidas(zona) : {}),
    ...(params.type ? { maintenanceType: params.type } : {}),
    ...(prioridad ? { priority: prioridad } : {}),
    ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
    ...(mias ? { assignedToId: user.id } : {}),
    ...(sinResponsable ? { assignedToId: null } : {}),
    ...(params.q
      ? { OR: [{ number: contiene(params.q) }, { title: contiene(params.q) }] }
      : {}),
  };

  const [encontradas, technicians, counts, total] = await Promise.all([
    prisma.workOrder.findMany({
      where,
      include: {
        asset: { select: { code: true, name: true } },
        assignedTo: { select: { name: true, color: true } },
        createdBy: { select: { name: true } },
        site: { select: { name: true } },
        location: { select: { name: true } },
        team: { select: { name: true } },
        plan: { select: { name: true } },
        failureCode: { select: { description: true } },
        rootCause: { select: { description: true } },
      },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 200,
    }),
    prisma.user.findMany({
      where: { organizationId: orgId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.workOrder.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: { _all: true },
    }),
    // Cuantas cumplen el filtro DE VERDAD, no cuantas cupieron en el tope.
    prisma.workOrder.count({ where }),
  ]);

  const workOrders = soloVencidas
    ? encontradas.filter((w) => estadoDeVencimiento(w, { zona }).clave === "VENCIDA")
    : encontradas;

  const openCount = counts
    .filter((c) => OPEN_STATUSES.includes(c.status))
    .reduce((sum, c) => sum + c._count._all, 0);
  const totalCost = workOrders.reduce((sum, wo) => sum + wo.totalCost, 0);

  const vista = vistaGuardada(user.vistasTabla, "ordenes");
  const moneda = user.organization.currency;

  const filas: FilaOrden[] = workOrders.map((w) => ({
    id: w.id,
    number: w.number,
    title: w.title,
    activo: w.asset?.name ?? null,
    activoCodigo: w.asset?.code ?? null,
    sitio: w.site?.name ?? null,
    ubicacion: w.location?.name ?? null,
    maintenanceType: w.maintenanceType,
    priority: w.priority,
    status: w.status,
    responsable: w.assignedTo?.name ?? null,
    responsableColor: w.assignedTo?.color ?? null,
    creadaPor: w.createdBy?.name ?? null,
    cuadrilla: w.team?.name ?? null,
    plan: w.plan?.name ?? null,
    modoFalla: w.failureCode?.description ?? null,
    causaRaiz: w.rootCause?.description ?? null,
    paroMinutos: w.downtimeMinutes,
    dueDate: w.dueDate?.toISOString() ?? null,
    startedAt: w.startedAt?.toISOString() ?? null,
    completedAt: w.completedAt?.toISOString() ?? null,
    closedAt: w.closedAt?.toISOString() ?? null,
    vencimiento: estadoDeVencimiento(w, { zona }),
    createdAt: w.createdAt.toISOString(),
    estimatedHours: w.estimatedHours,
    actualHours: w.actualHours,
    // Sin costos, los importes ni viajan al navegador.
    laborCost: conCostos ? w.laborCost : 0,
    partsCost: conCostos ? w.partsCost : 0,
    serviceCost: conCostos ? w.serviceCost : 0,
    otherCost: conCostos ? w.otherCost : 0,
    totalCost: conCostos ? w.totalCost : 0,
    moneda,
  }));

  return (
    <>
      <PageHeader
        title={mias ? "Mis órdenes" : sinResponsable ? "Órdenes sin responsable" : "Órdenes de trabajo"}
        description={`${soloVencidas ? "Vencidas: " : ""}${total > workOrders.length ? `${workOrders.length} de ${total}` : `${workOrders.length}`} resultados · ${openCount} abiertas en total${conCostos ? ` · costo listado ${formatCurrency(totalCost, user.organization.currency)}` : ""}`}
        actions={can(user.role, "workorder:write") ? (
          <div className="flex gap-2">
            {/* Armar junta trabajo de varios origenes en una sola orden; Nueva
                sigue siendo la captura suelta de un correctivo. */}
            <LinkButton href="/work-orders/armar" size="sm" variant="secondary">Armar orden</LinkButton>
            <LinkButton href="/work-orders/new" size="sm">Nueva orden</LinkButton>
          </div>
        ) : undefined}
      />

      <WorkOrderFilters technicians={technicians} puedeExportar={can(user.role, "data:export")} />

      {workOrders.length === 0 ? (
        <EmptyState
          title="Sin resultados"
          description="Ajuste los filtros o cree una nueva orden de trabajo."
          action={can(user.role, "workorder:write") ? <LinkButton href="/work-orders/new" size="sm">Nueva orden</LinkButton> : undefined}
        />
      ) : (
        <TablaOrdenes ordenes={filas} vistaInicial={vista} conCostos={conCostos} total={total} />
      )}
    </>
  );
}
