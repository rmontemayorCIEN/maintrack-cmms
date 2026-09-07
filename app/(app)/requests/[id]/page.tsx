import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Avatar, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { Adjuntos } from "@/components/adjuntos";
import {
  MAINTENANCE_TYPE_COLORS, MAINTENANCE_TYPE_LABELS,
  PRIORITY_COLORS, PRIORITY_LABELS,
  REQUEST_STATUS_COLORS, REQUEST_STATUS_LABELS,
  WO_STATUS_COLORS, WO_STATUS_LABELS,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { ReviewActions } from "../review-actions";
import { TriageSolicitud } from "./triage";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Acotado a la organizacion, igual que la pagina.
  const user = await requireUser();
  const r = await prisma.workRequest.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { number: true },
  });
  return { title: r ? r.number : "Solicitud" };
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const solicitud = await prisma.workRequest.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      asset: { select: { id: true, code: true, name: true } },
      site: { select: { name: true } },
      location: { select: { name: true } },
      requestedBy: { select: { name: true, color: true } },
      reviewedBy: { select: { name: true } },
      workOrder: { select: { id: true, number: true, status: true, maintenanceType: true } },
      attachments: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, kind: true, size: true, mimeType: true,
          createdAt: true, uploadedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!solicitud) notFound();

  // El duplicado que propuso la IA viene como folio; se resuelve a identificador
  // para poder ligarlo, y solo si sigue existiendo en esta organizacion.
  const duplicado = solicitud.iaDuplicadoDe
    ? await prisma.workRequest.findFirst({
        where: { organizationId: user.organizationId, number: solicitud.iaDuplicadoDe },
        select: { id: true },
      })
    : null;

  const triageDisponible =
    iaConfigurada() &&
    (user.isSuperAdmin || iaDeLaOrganizacion(user.organization).funciones.includes("TRIAGE"));

  const tecnicos = can(user.role, "request:review")
    ? await prisma.user.findMany({
        where: {
          organizationId: user.organizationId, active: true,
          role: { in: ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN"] },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  // El autor puede seguir documentando su reporte; el personal de
  // mantenimiento tambien, para dejar constancia del diagnostico.
  const puedeAdjuntar =
    can(user.role, "workorder:execute") ||
    (can(user.role, "request:create") && solicitud.requestedById === user.id);

  return (
    <>
      <PageHeader
        title={`${solicitud.number} — ${solicitud.title}`}
        breadcrumb={
          <Link href="/requests" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Solicitudes
          </Link>
        }
        actions={
          solicitud.status === "PENDING" && can(user.role, "request:review") ? (
            <ReviewActions requestId={solicitud.id} technicians={tecnicos} tipoActual={solicitud.tipo} tipoSugerido={solicitud.iaTipo} />
          ) : null
        }
      />

      <div className="mb-4">
        <TriageSolicitud
          requestId={solicitud.id}
          guardado={{
            titulo: solicitud.iaTitulo,
            prioridad: solicitud.iaPrioridad,
            tipo: solicitud.iaTipo,
            resumen: solicitud.iaResumen,
            duplicadoDe: solicitud.iaDuplicadoDe,
            el: solicitud.iaEl?.toISOString() ?? null,
          }}
          riesgo={solicitud.riesgo}
          riesgoMotivo={solicitud.riesgoMotivo}
          disponible={triageDisponible}
          editable={can(user.role, "request:review")}
          duplicadoId={duplicado?.id ?? null}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge className={REQUEST_STATUS_COLORS[solicitud.status]}>
          {REQUEST_STATUS_LABELS[solicitud.status]}
        </Badge>
        <Badge className={PRIORITY_COLORS[solicitud.priority]}>
          Urgencia {PRIORITY_LABELS[solicitud.priority]}
        </Badge>
        {solicitud.workOrder ? (
          <Link href={`/work-orders/${solicitud.workOrder.id}`}>
            <Badge className={WO_STATUS_COLORS[solicitud.workOrder.status]}>
              {solicitud.workOrder.number} · {WO_STATUS_LABELS[solicitud.workOrder.status]}
            </Badge>
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Lo reportado" />
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              {solicitud.description || "Sin detalle adicional."}
            </p>
            {solicitud.reviewNotes ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">
                  Nota de revision
                </p>
                <p className="mt-1 text-sm text-slate-700">{solicitud.reviewNotes}</p>
              </div>
            ) : null}
          </Card>

          <Card>
            <Adjuntos
              destino={{ workRequestId: solicitud.id }}
              editable={puedeAdjuntar}
              titulo="Fotos y evidencia del reporte"
              ayuda="Una imagen del sintoma suele ahorrar una visita de diagnostico."
              adjuntos={solicitud.attachments.map((a) => ({
                id: a.id, name: a.name, kind: a.kind, size: a.size,
                mimeType: a.mimeType, createdAt: a.createdAt.toISOString(),
                subidoPor: a.uploadedBy?.name ?? null,
              }))}
            />
          </Card>
        </div>

        <Card>
          <CardHeader title="Detalle" />
          <dl className="grid gap-3 text-sm">
            <Fila label="Activo">
              {solicitud.asset ? (
                <Link href={`/assets/${solicitud.asset.id}`} className="text-brand-600 hover:underline">
                  {solicitud.asset.code} · {solicitud.asset.name}
                </Link>
              ) : (
                <span className="text-slate-400">No identificado</span>
              )}
            </Fila>
            <Fila label="Ubicacion">
              {[solicitud.site?.name, solicitud.location?.name].filter(Boolean).join(" / ") || "—"}
            </Fila>
            <Fila label="Reporto">
              {solicitud.requestedBy ? (
                <span className="inline-flex items-center gap-2">
                  <Avatar name={solicitud.requestedBy.name} color={solicitud.requestedBy.color} />
                  {solicitud.requestedBy.name}
                </span>
              ) : "—"}
            </Fila>
            <Fila label="Fecha del reporte">{formatDateTime(solicitud.createdAt)}</Fila>
            {solicitud.reviewedBy ? (
              <>
                <Fila label="Reviso">{solicitud.reviewedBy.name}</Fila>
                <Fila label="Fecha de revision">{formatDateTime(solicitud.reviewedAt)}</Fila>
              </>
            ) : null}
            {solicitud.workOrder ? (
              <Fila label="Orden generada">
                <Link href={`/work-orders/${solicitud.workOrder.id}`} className="text-brand-600 hover:underline">
                  {solicitud.workOrder.number}
                </Link>
                <Badge className={`ml-2 ${MAINTENANCE_TYPE_COLORS[solicitud.workOrder.maintenanceType]}`}>
                  {MAINTENANCE_TYPE_LABELS[solicitud.workOrder.maintenanceType]}
                </Badge>
              </Fila>
            ) : null}
          </dl>
        </Card>
      </div>
    </>
  );
}

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-700">{children}</dd>
    </div>
  );
}
