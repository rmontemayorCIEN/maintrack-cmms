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

  const workOrders = await prisma.workOrder.findMany({
    where: { organizationId: user.organizationId, status: { in: BOARD_STATUSES } },
    include: {
      asset: { select: { code: true, name: true } },
      assignedTo: { select: { name: true, color: true } },
    },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
    take: 300,
  });

  return (
    <>
      <PageHeader
        title="Tablero de ejecución"
        description="Arrastre las tarjetas para avanzar el flujo de trabajo. Solo se permiten transiciones validas."
      />
      <KanbanBoard
        zona={await zonaDeLaEmpresa(user.organizationId)}
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
          assignee: wo.assignedTo?.name ?? null,
          assigneeColor: wo.assignedTo?.color ?? null,
          estimatedHours: wo.estimatedHours,
        }))}
      />
    </>
  );
}
