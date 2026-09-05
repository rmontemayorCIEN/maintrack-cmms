import Link from "next/link";
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
import { dueLabel, formatCurrency, formatNumber } from "@/lib/utils";
import { WorkOrderFilters } from "./filters";
import { TablaOrdenes, type FilaOrden } from "./tabla-ordenes";
import { vistaGuardada } from "@/lib/vistas";

export const metadata = { title: "Ordenes de trabajo" };
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | undefined>>;

export default async function WorkOrdersPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const params = await searchParams;
  const orgId = user.organizationId;

  const where = {
    organizationId: orgId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.scope === "open" ? { status: { in: OPEN_STATUSES } } : {}),
    ...(params.type ? { maintenanceType: params.type } : {}),
    ...(params.priority ? { priority: params.priority } : {}),
    ...(params.assignedToId ? { assignedToId: params.assignedToId } : {}),
    ...(params.q
      ? { OR: [{ number: { contains: params.q } }, { title: { contains: params.q } }] }
      : {}),
  };

  const [workOrders, technicians, counts] = await Promise.all([
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
  ]);

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
    createdAt: w.createdAt.toISOString(),
    estimatedHours: w.estimatedHours,
    actualHours: w.actualHours,
    laborCost: w.laborCost,
    partsCost: w.partsCost,
    serviceCost: w.serviceCost,
    otherCost: w.otherCost,
    totalCost: w.totalCost,
    moneda,
  }));

  return (
    <>
      <PageHeader
        title="Ordenes de trabajo"
        description={`${workOrders.length} resultados · ${openCount} abiertas en total · costo listado ${formatCurrency(totalCost, user.organization.currency)}`}
        actions={
          <div className="flex gap-2">
            {/* Armar junta trabajo de varios origenes en una sola orden; Nueva
                sigue siendo la captura suelta de un correctivo. */}
            <LinkButton href="/work-orders/armar" size="sm" variant="secondary">Armar orden</LinkButton>
            <LinkButton href="/work-orders/new" size="sm">Nueva orden</LinkButton>
          </div>
        }
      />

      <WorkOrderFilters technicians={technicians} />

      {workOrders.length === 0 ? (
        <EmptyState
          title="Sin resultados"
          description="Ajuste los filtros o cree una nueva orden de trabajo."
          action={<LinkButton href="/work-orders/new" size="sm">Nueva orden</LinkButton>}
        />
      ) : (
        <TablaOrdenes ordenes={filas} vistaInicial={vista} />
      )}
    </>
  );
}
