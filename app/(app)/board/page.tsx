import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { BOARD_STATUSES } from "@/lib/constants";
import { KanbanBoard } from "./board";
import { zonaDeLaEmpresa } from "@/lib/indicadores";

export const metadata = { title: "Tablero" };
export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const user = await requireUser();

  const [workOrders, tecnicos, activos, familias, zona] = await Promise.all([
    prisma.workOrder.findMany({
      where: { organizationId: user.organizationId, status: { in: BOARD_STATUSES } },
      include: {
        // La categoria del activo viaja con la orden: es con lo que se filtra
        // por familia («solo compresores») sin una segunda consulta.
        asset: { select: { id: true, code: true, name: true, categoryId: true } },
        assignedTo: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 300,
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.assetCategory.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    zonaDeLaEmpresa(user.organizationId),
  ]);

  return (
    <>
      <PageHeader
        title="Tablero de ejecución"
        description="Arrastre las tarjetas para avanzar el flujo de trabajo. Solo se permiten transiciones validas."
      />
      <KanbanBoard
        zona={zona}
        tecnicos={tecnicos}
        activos={activos}
        familias={familias}
        workOrders={workOrders.map((wo) => ({
          id: wo.id,
          number: wo.number,
          title: wo.title,
          status: wo.status,
          priority: wo.priority,
          maintenanceType: wo.maintenanceType,
          dueDate: wo.dueDate?.toISOString() ?? null,
          completedAt: wo.completedAt?.toISOString() ?? null,
          asset: wo.asset ? `${wo.asset.code} · ${wo.asset.name}` : null,
          assetId: wo.asset?.id ?? null,
          categoryId: wo.asset?.categoryId ?? null,
          assignee: wo.assignedTo?.name ?? null,
          assigneeId: wo.assignedTo?.id ?? null,
          assigneeColor: wo.assignedTo?.color ?? null,
          estimatedHours: wo.estimatedHours,
        }))}
      />
    </>
  );
}
