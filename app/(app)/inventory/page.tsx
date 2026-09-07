import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader, Progress, Stat } from "@/components/ui";
import Link from "next/link";
import { ArrowLeftRight, BookOpen, Repeat, ClipboardCheck, Gauge, LineChart, Merge } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { PartDialog } from "./part-dialog";
import { TablaRefacciones, type FilaRefaccion } from "./tabla-refacciones";
import { vistaGuardada } from "@/lib/vistas";
import { MovementForm } from "./movement-form";
import { AdjuntosRefaccion } from "./adjuntos-refaccion";

export const metadata = { title: "Almacen" };
export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low?: string; almacen?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const currency = user.organization.currency;
  const editable = can(user.role, "inventory:write");

  const almacenes = await prisma.warehouse.findMany({
    where: { organizationId: user.organizationId, active: true },
    orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
    select: { id: true, code: true, name: true },
  });
  // El almacen elegido se valida contra los de la cuenta: el identificador
  // viene de la barra de direcciones y no se puede creer.
  const almacenActivo = almacenes.find((a) => a.id === params.almacen) ?? null;

  const [parts, suppliers, familias, unidades] = await Promise.all([
    prisma.part.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        ...(params.q ? { OR: [{ name: { contains: params.q } }, { code: { contains: params.q } }] } : {}),
      },
      include: {
        supplier: { select: { name: true } },
        attachments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, name: true, kind: true, size: true, mimeType: true,
            createdAt: true, uploadedBy: { select: { name: true } },
          },
        },
        links: {
          orderBy: { createdAt: "desc" },
          select: { id: true, title: true, url: true, note: true, createdAt: true },
        },
      },
      orderBy: { code: "asc" },
      take: 300,
    }),
    prisma.supplier.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.partCategory.findMany({
      where: { organizationId: user.organizationId },
      select: { code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.partUnit.findMany({
      where: { organizationId: user.organizationId },
      select: { code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const filtered = params.low === "1" ? parts.filter((p) => p.quantityOnHand <= p.minQuantity) : parts;

  const vista = vistaGuardada(user.vistasTabla, "refacciones");
  // Con un almacen elegido, la existencia que se muestra es la de ESE almacen,
  // no el total. Es lo que el almacenista tiene enfrente cuando cuenta.
  const existencias = almacenActivo
    ? new Map(
        (await prisma.partStock.findMany({
          where: { organizationId: user.organizationId, warehouseId: almacenActivo.id },
          select: { partId: true, quantity: true, minQuantity: true, maxQuantity: true, bin: true },
        })).map((e) => [e.partId, e]),
      )
    : null;

  const filas: FilaRefaccion[] = filtered.map((p) => {
    const e = existencias?.get(p.id);
    return {
    id: p.id, code: p.code, name: p.name,
    description: p.description, category: p.category,
    unit: p.unit, unitCost: p.unitCost,
    // Un minimo nulo en el almacen significa heredar el de la refaccion.
    quantityOnHand: e ? e.quantity : p.quantityOnHand,
    minQuantity: e?.minQuantity ?? p.minQuantity,
    maxQuantity: e?.maxQuantity ?? p.maxQuantity,
    bin: e?.bin ?? p.bin,
    supplierId: p.supplierId, proveedor: p.supplier?.name ?? null,
    moneda: currency,
    adjuntos: p.attachments.map((a) => ({
      id: a.id, name: a.name, kind: a.kind, size: a.size,
      mimeType: a.mimeType, createdAt: a.createdAt.toISOString(),
      subidoPor: a.uploadedBy?.name ?? null,
    })),
    enlaces: p.links.map((l) => ({
      id: l.id, title: l.title, url: l.url, note: l.note, createdAt: l.createdAt.toISOString(),
    })),
    };
  });

  // Los indicadores describen lo que se esta viendo. Con un almacen elegido,
  // "bajo mínimo" significa bajo minimo AHI, que es la pregunta que se hace
  // quien esta parado en ese almacen.
  const lowCount = filas.filter((f) => f.quantityOnHand <= f.minQuantity).length;
  const outOfStock = filas.filter((f) => f.quantityOnHand === 0).length;
  const inventoryValue = filas.reduce((sum, f) => sum + f.quantityOnHand * f.unitCost, 0);

  return (
    <>
      <PageHeader
        title={almacenActivo ? `Almacen · ${almacenActivo.name}` : "Almacén de refacciones"}
        description="Existencias, puntos de reorden y movimientos. El consumo en órdenes de trabajo descuenta automáticamente del inventario."
        actions={
          <>
          <Link
            href="/inventory/kardex"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <BookOpen className="h-3.5 w-3.5" /> Kardex
          </Link>
          <Link
            href="/inventory/traspasos"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" /> Traspasos
          </Link>
          <Link
            href="/inventory/conteos"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ClipboardCheck className="h-3.5 w-3.5" /> Conteos
          </Link>
          <Link
            href="/inventory/equivalencias"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Repeat className="h-3.5 w-3.5" /> Equivalencias
          </Link>
          <Link
            href="/inventory/duplicados"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Merge className="h-3.5 w-3.5" /> Limpieza
          </Link>
          <Link
            href="/inventory/indicadores"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Gauge className="h-3.5 w-3.5" /> Indicadores
          </Link>
          <Link
            href="/inventory/analisis"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <LineChart className="h-3.5 w-3.5" /> Analisis
          </Link>
          {editable ? (
            <PartDialog
              suppliers={suppliers}
              familias={familias}
              unidades={unidades}
              puedeGestionarCatalogos={can(user.role, "settings:write")}
            />
          ) : null}
          </>
        }
      />

      {almacenes.length > 1 ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[0.6875rem] font-medium uppercase tracking-wide text-slate-500">Almacen</span>
          <Link
            href={`/inventory${params.low === "1" ? "?low=1" : ""}`}
            className={`rounded-lg border px-2.5 py-1 text-xs transition ${
              almacenActivo ? "border-slate-200 text-slate-600 hover:bg-slate-50" : "border-brand-300 bg-brand-50 font-medium text-brand-700"
            }`}
          >
            Todos
          </Link>
          {almacenes.map((a) => (
            <Link
              key={a.id}
              href={`/inventory?almacen=${a.id}${params.low === "1" ? "&low=1" : ""}`}
              title={a.code}
              className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                almacenActivo?.id === a.id
                  ? "border-brand-300 bg-brand-50 font-medium text-brand-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {a.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="SKU activos" value={parts.length} />
        <Stat label="Bajo mínimo" value={lowCount} tone={lowCount ? "warn" : "good"} />
        <Stat label="Sin existencia" value={outOfStock} tone={outOfStock ? "bad" : "good"} />
        <Stat label="Valor del inventario" value={formatCurrency(inventoryValue, currency)} />
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={params.q ?? ""} className="field max-w-64" placeholder="Buscar refaccion…" />
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" name="low" value="1" defaultChecked={params.low === "1"} className="h-4 w-4 rounded border-slate-300" />
          Solo bajo minimo
        </label>
        <button type="submit" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
          Filtrar
        </button>
        <a href="/api/export/inventory" className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
          Exportar CSV
        </a>
      </form>

      {filtered.length === 0 ? (
        <EmptyState title="Sin refacciones" description="Registre su catálogo de refacciones y consumibles." />
      ) : (
        <TablaRefacciones
          refacciones={filas}
          vistaInicial={vista}
          editable={editable}
          suppliers={suppliers}
          familias={familias}
          unidades={unidades}
          puedeGestionarCatalogos={can(user.role, "settings:write")}
          warehouseId={almacenActivo?.id ?? null}
        />
      )}

    </>
  );
}
