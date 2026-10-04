import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";
import { vistaGuardada } from "@/lib/vistas";
import { TablaCompras, type FilaCompra } from "./tabla-compras";
import { CompraDialog } from "./compra-dialog";
import Link from "next/link";
import { ESTADOS_COMPRA } from "@/lib/estados-compra";

export const metadata = { title: "Requisiciones de compra" };
export const dynamic = "force-dynamic";

export default async function ComprasPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  // Los accesos del inicio de Compras llegan con el estado ya elegido.
  const { estado } = await searchParams;
  const filtro = estado && estado in ESTADOS_COMPRA ? estado : null;
  const user = await requireUser();
  const orgId = user.organizationId;
  const moneda = user.organization.currency;
  const puedePedir = can(user.role, "purchase:request");

  const [compras, almacenes, refacciones, proveedores] = await Promise.all([
    prisma.purchaseRequest.findMany({
      // El estado se filtra en la base: filtrarlo despues del tope hacia que
      // «mostrando: Solicitadas (12)» significara «12 de las 300 que cupieron»
      // y no «12 que hay».
      where: { organizationId: orgId, ...(filtro ? { estado: filtro } : {}) },
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

  const listadas = filas;
  // Los dos resumenes de arriba son de TODA la empresa, no de lo que se este
  // mostrando: se cuentan y se suman en la base, no sobre la lista filtrada.
  const [porAutorizar, porLlegar] = await Promise.all([
    prisma.purchaseRequest.count({ where: { organizationId: orgId, estado: "SOLICITADA" } }),
    prisma.purchaseRequest.aggregate({
      where: { organizationId: orgId, estado: { in: ["AUTORIZADA", "EN_COMPRA", "RECIBIDA_PARCIAL"] } },
      _count: { _all: true }, _sum: { montoEstimado: true },
    }),
  ]);

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
            moneda={moneda}
            almacenes={almacenes}
            refacciones={refacciones.map((r) => ({ id: r.id, code: r.code, name: r.name, unit: r.unit, costo: r.unitCost }))}
            proveedores={proveedores}
          />
        ) : undefined}
      />

      {filas.length ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Esperando autorización" value={String(porAutorizar)} tone={porAutorizar ? "warn" : "good"} />
          <Stat
            label="Comprometido por llegar"
            value={formatCurrency(porLlegar._sum.montoEstimado ?? 0, moneda)}
            hint={`${porLlegar._count._all} requisiciones`}
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
        <>
          {filtro ? (
            <p className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-700" role="status">
              Mostrando: <strong>{ESTADOS_COMPRA[filtro as keyof typeof ESTADOS_COMPRA]}</strong> ({listadas.length})
              <Link href="/compras" className="inline-flex min-h-9 items-center text-brand-700 underline">Ver todas</Link>
            </p>
          ) : null}
          <TablaCompras compras={listadas} vistaInicial={vistaGuardada(user.vistasTabla, "compras")} />
        </>
      )}
    </>
  );
}
