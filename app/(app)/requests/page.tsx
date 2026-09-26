import { motivoSinOtActiva } from "@/lib/reglas-ot";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { RequestDialog } from "./request-dialog";
import { TablaSolicitudes, type FilaSolicitud } from "./tabla-solicitudes";
import { vistaGuardada } from "@/lib/vistas";
import { puedeVerRuta, veTodasLasSolicitudes } from "@/lib/pantallas";

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

  const filas: FilaSolicitud[] = requests.map((r) => {
    const sinOt = motivoSinOtActiva(r.status, r.workOrder);
    return {
      id: r.id, numero: r.number, titulo: r.title,
      descripcion: r.description, notaDeRevision: r.reviewNotes,
      adjuntos: r._count.attachments,
      activo: r.asset ? `${r.asset.code} · ${r.asset.name}` : null,
      prioridad: r.priority, estado: r.status,
      solicitante: r.requestedBy?.name ?? null,
      colorSolicitante: r.requestedBy?.color ?? null,
      creada: r.createdAt.toISOString(),
      otId: r.workOrder?.id ?? null, otNumero: r.workOrder?.number ?? null,
      sinOtCorto: sinOt?.corto ?? null,
      sinOtLargo: sinOt ? `${sinOt.largo} Aparece en la calidad de captura para revisarla.` : null,
      assetId: r.assetId, tipo: r.tipo, tipoSugerido: r.iaTipo,
    };
  });

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
        <TablaSolicitudes
          solicitudes={filas}
          vistaInicial={vistaGuardada(user.vistasTabla, todas ? "solicitudes" : "mis-reportes")}
          veOrdenes={veOrdenes}
          conSolicitante={todas}
          revision={canReview ? { technicians, assets } : null}
        />
        </>
      )}
    </>
  );
}
