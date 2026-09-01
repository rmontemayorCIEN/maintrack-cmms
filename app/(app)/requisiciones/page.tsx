import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { OPEN_STATUSES } from "@/lib/constants";
import { vistaGuardada } from "@/lib/vistas";
import { TablaRequisiciones, type FilaRequisicion } from "./tabla-requisiciones";
import { RequisicionDialog, type RefaccionOpcion } from "./requisicion-dialog";

export const metadata = { title: "Requisiciones de material" };
export const dynamic = "force-dynamic";

export default async function RequisicionesPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const puedePedir = can(user.role, "requisition:create");

  const [requisiciones, almacenes, ordenes, activos, existencias, catalogo] = await Promise.all([
    prisma.materialRequest.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true, folio: true, motivo: true, urgencia: true, estado: true,
        nota: true, createdAt: true, cerradaEl: true,
        warehouse: { select: { name: true } },
        solicitante: { select: { name: true } },
        workOrder: { select: { number: true, title: true } },
        asset: { select: { code: true, name: true } },
        renglones: { select: { cantidadSolicitada: true, cantidadSurtida: true, cantidadDevuelta: true } },
      },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.workOrder.findMany({
      where: { organizationId: orgId, status: { in: OPEN_STATUSES } },
      orderBy: { number: "desc" },
      take: 200,
      select: { id: true, number: true, title: true, asset: { select: { code: true, name: true } } },
    }),
    prisma.asset.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: { code: "asc" },
      take: 500,
      select: { id: true, code: true, name: true },
    }),
    // El catalogo completo, y aparte la existencia por almacen. Se puede pedir
    // algo que no hay: es justo asi como llega a compras lo que falta.
    prisma.partStock.findMany({
      where: { organizationId: orgId, part: { active: true } },
      select: { warehouseId: true, quantity: true, partId: true },
    }),
    prisma.part.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, unit: true },
    }),
  ]);

  const porAlmacen: Record<string, Record<string, number>> = {};
  for (const e of existencias) {
    (porAlmacen[e.warehouseId] ??= {})[e.partId] = e.quantity;
  }

  const filas: FilaRequisicion[] = requisiciones.map((r) => ({
    id: r.id, folio: r.folio,
    almacen: r.warehouse.name,
    motivo: r.motivo, urgencia: r.urgencia, estado: r.estado,
    solicitante: r.solicitante?.name ?? null,
    orden: r.workOrder ? `${r.workOrder.number} · ${r.workOrder.title}` : null,
    activo: r.asset ? `${r.asset.code} · ${r.asset.name}` : null,
    renglones: r.renglones.length,
    pedido: r.renglones.reduce((s, l) => s + l.cantidadSolicitada, 0),
    surtido: r.renglones.reduce((s, l) => s + l.cantidadSurtida, 0),
    devuelto: r.renglones.reduce((s, l) => s + l.cantidadDevuelta, 0),
    nota: r.nota,
    createdAt: r.createdAt.toISOString(),
    cerradaEl: r.cerradaEl?.toISOString() ?? null,
  }));

  const abiertas = filas.filter((f) => f.estado === "SOLICITADA" || f.estado === "PARCIAL");
  const conParo = abiertas.filter((f) => f.urgencia === "PARO");

  return (
    <>
      <PageHeader
        title="Requisiciones de material"
        description="Lo que mantenimiento le pide al almacén. Se surte contra orden de trabajo y lo que sobra se devuelve."
        actions={puedePedir && almacenes.length ? (
          <RequisicionDialog
            almacenes={almacenes.map((a) => ({ id: a.id, etiqueta: a.name }))}
            ordenes={ordenes.map((o) => ({
              id: o.id,
              etiqueta: `${o.number} · ${o.title}`,
              // El activo viaja con la orden para poder mostrarlo heredado en
              // vez de volver a preguntarlo.
              activo: o.asset ? `${o.asset.code} · ${o.asset.name}` : null,
            }))}
            activos={activos.map((a) => ({ id: a.id, etiqueta: `${a.code} · ${a.name}` }))}
            refacciones={catalogo.map((r) => ({ id: r.id, code: r.code, name: r.name, unit: r.unit }))}
            existencias={porAlmacen}
          />
        ) : undefined}
      />

      {filas.length ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Por surtir" value={String(abiertas.length)} tone={abiertas.length ? "warn" : "good"} />
          <Stat
            label="Con equipo parado"
            value={String(conParo.length)}
            tone={conParo.length ? "bad" : "good"}
            hint={conParo.length ? conParo.map((c) => c.folio).slice(0, 3).join(", ") : "Ninguna"}
          />
          <Stat label="Requisiciones registradas" value={String(filas.length)} />
        </div>
      ) : null}

      {filas.length === 0 ? (
        <EmptyState
          title="Sin requisiciones"
          description="Cuando mantenimiento pida material al almacén, las requisiciones aparecerán aquí con lo que falta por surtir."
        />
      ) : (
        <TablaRequisiciones requisiciones={filas} vistaInicial={vistaGuardada(user.vistasTabla, "requisiciones")} />
      )}
    </>
  );
}
