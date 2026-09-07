import Link from "next/link";
import { Paperclip } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Avatar, Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  REQUEST_STATUS_COLORS,
  REQUEST_STATUS_LABELS,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { RequestDialog } from "./request-dialog";
import { ReviewActions } from "./review-actions";

export const metadata = { title: "Solicitudes de servicio" };
export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const user = await requireUser();
  const canReview = can(user.role, "request:review");

  const [requests, assets, technicians] = await Promise.all([
    prisma.workRequest.findMany({
      where: { organizationId: user.organizationId },
      include: {
        asset: { select: { code: true, name: true } },
        requestedBy: { select: { name: true, color: true } },
        reviewedBy: { select: { name: true } },
        workOrder: { select: { id: true, number: true } },
        _count: { select: { attachments: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, active: true, role: { in: ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const pending = requests.filter((r) => r.status === "PENDING");
  const converted = requests.filter((r) => r.status === "CONVERTED").length;

  return (
    <>
      <PageHeader
        title="Solicitudes de servicio"
        description="Reportes de falla levantados por produccion u operaciones. Al aprobarse se convierten en orden de trabajo correctiva."
        actions={<RequestDialog assets={assets} />}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Pendientes de revision" value={pending.length} tone={pending.length ? "warn" : "good"} />
        <Stat label="Convertidas en OT" value={converted} />
        <Stat label="Total historico" value={requests.length} />
      </div>

      {requests.length === 0 ? (
        <EmptyState
          title="Sin solicitudes"
          description="Cualquier usuario con rol de solicitante puede reportar una falla desde aqui."
        />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Reporte</th>
                  <th>Activo</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                  <th>Solicitante</th>
                  <th>Fecha</th>
                  <th>OT</th>
                  {canReview ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <Link href={`/requests/${request.id}`} className="font-medium text-brand-600 hover:underline">
                        {request.number}
                      </Link>
                    </td>
                    <td className="max-w-72">
                      <Link href={`/requests/${request.id}`} className="block truncate font-medium text-slate-800 hover:text-brand-600">
                        {request.title}
                      </Link>
                      {request.description ? (
                        <p className="truncate text-xs text-slate-500">{request.description}</p>
                      ) : null}
                      {request.reviewNotes ? (
                        <p className="mt-0.5 truncate text-xs italic text-slate-400">
                          Nota: {request.reviewNotes}
                        </p>
                      ) : null}
                      {request._count.attachments ? (
                        <p className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-slate-500">
                          <Paperclip className="h-3 w-3" />
                          {request._count.attachments}{" "}
                          {request._count.attachments === 1 ? "archivo" : "archivos"}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-xs text-slate-600">
                      {request.asset ? `${request.asset.code} · ${request.asset.name}` : "—"}
                    </td>
                    <td><Badge className={PRIORITY_COLORS[request.priority]}>{PRIORITY_LABELS[request.priority]}</Badge></td>
                    <td>
                      <Badge className={REQUEST_STATUS_COLORS[request.status]}>
                        {REQUEST_STATUS_LABELS[request.status]}
                      </Badge>
                    </td>
                    <td>
                      {request.requestedBy ? (
                        <div className="flex items-center gap-2">
                          <Avatar name={request.requestedBy.name} color={request.requestedBy.color} />
                          <span className="text-xs text-slate-600">{request.requestedBy.name}</span>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="text-xs text-slate-500">{formatDateTime(request.createdAt)}</td>
                    <td className="text-xs">
                      {request.workOrder ? (
                        <Link href={`/work-orders/${request.workOrder.id}`} className="text-brand-600 hover:underline">
                          {request.workOrder.number}
                        </Link>
                      ) : "—"}
                    </td>
                    {canReview ? (
                      <td className="text-right">
                        {request.status === "PENDING" ? (
                          <ReviewActions requestId={request.id} technicians={technicians} tipoActual={request.tipo} tipoSugerido={request.iaTipo} />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
