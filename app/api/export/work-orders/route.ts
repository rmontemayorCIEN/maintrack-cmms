import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { withAuth } from "@/lib/api";
import { toCsv } from "@/lib/utils";
import {
  MAINTENANCE_TYPE_LABELS,
  OPEN_STATUSES,
  PRIORITY_LABELS,
  WO_STATUS_LABELS,
} from "@/lib/constants";

export async function GET(request: Request) {
  return withAuth("data:export", async ({ orgId, user }) => {
    const params = new URL(request.url).searchParams;
    const workOrders = await prisma.workOrder.findMany({
      where: {
        organizationId: orgId,
        ...(params.get("status") ? { status: params.get("status")! } : {}),
        ...(params.get("scope") === "open" ? { status: { in: OPEN_STATUSES } } : {}),
        ...(params.get("type") ? { maintenanceType: params.get("type")! } : {}),
        ...(params.get("priority") ? { priority: params.get("priority")! } : {}),
        ...(params.get("assignedToId") ? { assignedToId: params.get("assignedToId")! } : {}),
      },
      include: {
        asset: { select: { code: true, name: true } },
        assignedTo: { select: { name: true } },
        failureCode: { select: { code: true } },
      rootCause: { select: { description: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const csv = toCsv(
      workOrders.map((wo) => ({
        Folio: wo.number,
        Titulo: wo.title,
        Tipo: MAINTENANCE_TYPE_LABELS[wo.maintenanceType],
        Estado: WO_STATUS_LABELS[wo.status],
        Prioridad: PRIORITY_LABELS[wo.priority],
        Activo: wo.asset ? `${wo.asset.code} ${wo.asset.name}` : "",
        Responsable: wo.assignedTo?.name ?? "",
        Creada: wo.createdAt.toISOString().slice(0, 10),
        Compromiso: wo.dueDate?.toISOString().slice(0, 10) ?? "",
        Inicio: wo.startedAt?.toISOString().slice(0, 10) ?? "",
        Termino: wo.completedAt?.toISOString().slice(0, 10) ?? "",
        HorasEstimadas: wo.estimatedHours,
        HorasReales: wo.actualHours,
        ParoMinutos: wo.downtimeMinutes,
        CodigoFalla: wo.failureCode?.code ?? "",
        CausaRaiz: wo.rootCause?.description ?? "",
        CostoManoObra: wo.laborCost,
        CostoRefacciones: wo.partsCost,
        CostoServiciosExternos: wo.serviceCost,
        CostoTotal: wo.totalCost,
      })),
    );

    // Llevarse la informacion queda registrado: es de las acciones que hay que
    // poder reconstruir despues —quien bajo que, y cuando—.
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "WorkOrder", entityId: "export",
      action: "EXPORTED",
      summary: `Exportó ordenes de trabajo (${workOrders.length} renglones)`,
    });

    return new Response(`\ufeff${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ordenes-trabajo-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    }) as never;
  }, { esLectura: true });
}
