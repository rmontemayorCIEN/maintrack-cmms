import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";
import { vistaGuardada } from "@/lib/vistas";
import { TablaCompras, type FilaCompra } from "./tabla-compras";
import { CompraDialog } from "./compra-dialog";

export const metadata = { title: "Requisiciones de compra" };
export const dynamic = "force-dynamic";

export default async function ComprasPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const moneda = user.organization.currency;
  const puedePedir = can(user.role, "purchase:request");

  const [compras, almacenes, refacciones, proveedores] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true, folio: true, estado: true, urgencia: true, montoEstimado: true,
        justificacion: true, motivoRechazo: true, ordenCompra: true,
        createdAt: true, autorizadaEl: true,
        warehouse: { select: { name: true } },
        solicitante: { select: { name: true } },
        autorizadaPor: { select: { name: true } },
        proveedorSugerido: { select: { name: true } },
        materialRequest: { select: { id: true, folio: true } },
        renglones: { select: { cantidadSolicitada: true, cantidadRecibida: true } },
      },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.part.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, unit: true, unitCost: true },
    }),
    prisma.supplier.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const filas: FilaCompra[] = compras.map((c) => ({
    id: c.id, folio: c.folio,
    almacen: c.warehouse.name, estado: c.estado, urgencia: c.urgencia,
    solicitante: c.solicitante?.name ?? null,
    autorizadaPor: c.autorizadaPor?.name ?? null,
    proveedorSugerido: c.proveedorSugerido?.name ?? null,
    requisicion: c.materialRequest?.folio ?? null,
    requisicionId: c.materialRequest?.id ?? null,
    ordenCompra: c.ordenCompra,
    renglones: c.renglones.length,
    pedido: c.renglones.reduce((s, l) => s + l.cantidadSolicitada, 0),
    recibido: c.renglones.reduce((s, l) => s + l.cantidadRecibida, 0),
    montoEstimado: c.montoEstimado,
    justificacion: c.justificacion,
    motivoRechazo: c.motivoRechazo,
    createdAt: c.createdAt.toISOString(),
    autorizadaEl: c.autorizadaEl?.toISOString() ?? null,
    moneda,
  }));

  const porAutorizar = filas.filter((f) => f.estado === "SOLICITADA");
  const porLlegar = filas.filter((f) => ["AUTORIZADA", "EN_COMPRA", "RECIBIDA_PARCIAL"].includes(f.estado));

  return (
    <>
      <PageHeader
        title="Requisiciones de compra"
        description={
          user.organization.comprasInternas
            ? "Lo que no hay en almacén y hay que adquirir. El proceso de compras corre dentro de MainTrack."
            : "Lo que no hay en almacén y hay que adquirir. Compras corre en su sistema externo: aquí se anota el folio de la orden y se recibe contra ella."
        }
        actions={puedePedir && almacenes.length ? (
          <CompraDialog
            almacenes={almacenes}
            refacciones={refacciones.map((r) => ({ id: r.id, code: r.code, name: r.name, unit: r.unit, costo: r.unitCost }))}
            proveedores={proveedores}
          />
        ) : undefined}
      />

      {filas.length ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Esperando autorización" value={String(porAutorizar.length)} tone={porAutorizar.length ? "warn" : "good"} />
          <Stat
            label="Comprometido por llegar"
            value={formatCurrency(porLlegar.reduce((s, f) => s + f.montoEstimado, 0), moneda)}
            hint={`${porLlegar.length} requisiciones`}
          />
          <Stat label="Registradas" value={String(filas.length)} />
        </div>
      ) : null}

      {filas.length === 0 ? (
        <EmptyState
          title="Sin requisiciones de compra"
          description="Cuando el almacén no pueda surtir algo, aquí queda registrado lo que hay que comprar y quién lo autorizó."
        />
      ) : (
        <TablaCompras compras={filas} vistaInicial={vistaGuardada(user.vistasTabla, "compras")} />
      )}
    </>
  );
}
