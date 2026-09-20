import Link from "next/link";
import { motivoSinOtActiva } from "@/lib/reglas-ot";
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
import { puedeVerRuta, veTodasLasSolicitudes } from "@/lib/pantallas";
import { RegistrarLista } from "@/components/paso-registros";

export const metadata = { title: "Solicitudes de servicio" };
export const dynamic = "force-dynamic";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ nueva?: string; activo?: string }> }) {
  const user = await requireUser();
  const canReview = can(user.role, "request:review");
  const todas = veTodasLasSolicitudes(user.role);
  // El solicitante no conoce el CMMS: la pantalla le habla de «sus reportes».
  const soloMias = !todas;
  const veOrdenes = puedeVerRuta(user.role, "/work-orders");
  const { nueva, activo } = await searchParams;

  const [requests, assets, technicians] = await Promise.all([
    prisma.workRequest.findMany({
      where: { organizationId: user.organizationId, ...(todas ? {} : { requestedById: user.id }) },
      include: {
        asset: { select: { code: true, name: true } },
        requestedBy: { select: { name: true, color: true } },
        reviewedBy: { select: { name: true } },
        workOrder: { select: { id: true, number: true, status: true } },
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
        title={soloMias ? "Mis reportes" : "Solicitudes de servicio"}
        description={soloMias
          ? "Lo que usted ha reportado y en qué va. Cuando se atiende, aquí lo verá."
          : "Reportes de falla levantados por producción u operaciones. Al aprobarse se convierten en orden de trabajo correctiva."}
        actions={can(user.role, "request:create")
          ? <RequestDialog assets={assets} abrirAlInicio={nueva === "1"} activoInicial={activo} textoBoton={soloMias ? "Reportar un problema" : "Reportar falla"} />
          : undefined}
      />

      {soloMias ? null : (
        <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-4">
          <Stat label="Pendientes de revisión" value={pending.length} tone={pending.length ? "warn" : "good"} />
          <Stat label="Convertidas en OT" value={converted} />
          <Stat label="Total histórico" value={requests.length} />
        </div>
      )}

      {requests.length === 0 ? (
        <EmptyState
          title={soloMias ? "Todavía no ha reportado nada" : "Sin solicitudes"}
          description={soloMias
            ? "Cuando algo falle, tóquele a «Reportar un problema»: se avisa a quien lo revisa."
            : "Cualquier usuario con rol de solicitante puede reportar una falla desde aquí."}
        />
      ) : (
        <>
        {/* Para pasar de un reporte al siguiente desde el detalle, en este mismo orden. */}
        <RegistrarLista base="/requests" items={requests.map((r) => ({ id: r.id, etiqueta: `${r.number} · ${r.title}` }))} />
        {/* Teléfono: una tarjeta por reporte, con lo que importa arriba. */}
        <ul className="grid gap-2 md:hidden">
          {requests.map((r) => {
            const sinOt = motivoSinOtActiva(r.status, r.workOrder);
            return (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <Link href={`/requests/${r.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-brand-700">{r.number}</span>
                    <Badge className={REQUEST_STATUS_COLORS[r.status]}>{REQUEST_STATUS_LABELS[r.status]}</Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-900">{r.title}</p>
                  {r.reviewNotes ? <p className="mt-1 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-900">Respuesta de quien revisa: {r.reviewNotes}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {r.asset ? `${r.asset.code} · ${r.asset.name} · ` : ""}{formatDateTime(r.createdAt)}
                    {r._count.attachments ? ` · ${r._count.attachments} foto(s)` : ""}
                  </p>
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <Badge className={PRIORITY_COLORS[r.priority]}>{PRIORITY_LABELS[r.priority]}</Badge>
                  {r.workOrder ? (
                    veOrdenes
                      ? <Link href={`/work-orders/${r.workOrder.id}`} className="font-medium text-brand-700">Orden {r.workOrder.number}</Link>
                      : <span className="text-slate-600">Se atiende con la orden {r.workOrder.number}</span>
                  ) : sinOt ? <span className="text-amber-700">{sinOt.corto}</span> : null}
                  {soloMias ? null : r.requestedBy ? <span className="text-slate-500">· {r.requestedBy.name}</span> : null}
                </div>
                {canReview && r.status === "PENDING" ? (
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <ReviewActions requestId={r.id} technicians={technicians} assets={assets} assetActual={r.assetId} tipoActual={r.tipo} tipoSugerido={r.iaTipo} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Card padded={false} className="hidden md:block">
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
                        veOrdenes ? (
                          <Link href={`/work-orders/${request.workOrder.id}`} className="text-brand-600 hover:underline">
                            {request.workOrder.number}
                          </Link>
                        ) : <span className="text-slate-600">{request.workOrder.number}</span>
                      ) : null}
                      {(() => {
                        const sinOt = motivoSinOtActiva(request.status, request.workOrder);
                        return sinOt ? (
                          <span className="block text-amber-700" title={`${sinOt.largo} Aparece en la calidad de captura para revisarla.`}>
                            {sinOt.corto}
                          </span>
                        ) : request.workOrder ? null : "—";
                      })()}
                    </td>
                    {canReview ? (
                      <td className="text-right">
                        {request.status === "PENDING" ? (
                          <ReviewActions requestId={request.id} technicians={technicians} assets={assets} assetActual={request.assetId} tipoActual={request.tipo} tipoSugerido={request.iaTipo} />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        </>
      )}
    </>
  );
}
