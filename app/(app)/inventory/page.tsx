import { ESTADOS_COMPRA_ABIERTA } from "@/lib/compras";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader, Progress, Stat } from "@/components/ui";
import Link from "next/link";
import { ArrowLeftRight, BookOpen, Repeat, ClipboardCheck, Gauge, LineChart, Merge } from "lucide-react";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { PartDialog } from "./part-dialog";
import { TablaRefacciones, type FilaRefaccion } from "./tabla-refacciones";
import { verCostosDeAlmacen } from "@/lib/pantallas";
import { vistaGuardada } from "@/lib/vistas";
import { MovementForm } from "./movement-form";
import { AdjuntosRefaccion } from "./adjuntos-refaccion";
import { contiene } from "@/lib/busqueda-texto";
import { franjaDeAlmacen, resumenDeLaFranja } from "@/lib/almacen-vista";
import { FranjaAlmacen } from "./franja-almacen";
import { estaBajoMinimo } from "@/lib/almacen-estado";
import { FranjaPlegable } from "./franja-plegable";

export const metadata = { title: "Almacén" };
export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low?: string; almacen?: string; categoria?: string }>;
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

  // La franja mira SIEMPRE el almacen completo, aunque la tabla de abajo este
  // filtrada: es el panorama, y un panorama que cambia con el filtro deja de
  // servir para saber donde hay que mirar.
  const franja = await franjaDeAlmacen(user.organizationId);

  const [parts, suppliers, familias, unidades] = await Promise.all([
    prisma.part.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        ...(params.q ? { OR: [{ name: contiene(params.q) }, { code: contiene(params.q) }] } : {}),
        // Bajo minimo se decide en la base y no despues del tope: con 300
        // refacciones traidas, la que estaba bajo minimo en el lugar 350 no
        // aparecia nunca, y la pantalla decia que no habia ninguna.
        // Bajo minimo se decide con el criterio unico (lib/almacen-estado.ts):
        // hace falta que haya minimo capturado. Antes era `lte` sin exigirlo,
        // asi que una refaccion en cero y SIN minimo salia como «bajo minimo»
        // aqui y no salia en el analisis del almacen: dos numeros para la misma
        // pregunta. Sin minimo no se sabe, y eso se dice aparte.
        ...(params.low === "1"
          ? { minQuantity: { gt: 0 }, quantityOnHand: { lt: prisma.part.fields.minQuantity } }
          : {}),
        // Familia: es a donde lleva cada renglon de la franja de arriba. Sin
        // esto los renglones no tenian a donde ir.
        ...(params.categoria ? { category: params.categoria } : {}),
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

  const filtered = parts;

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
  /**
   * Lo que ya viene en camino, por refaccion.
   *
   * Sin esto, la lista de «bajo minimo» vuelve a proponer comprar algo que ya
   * se pidio la semana pasada y llegan dos veces.
   */
  const enCamino = await prisma.purchaseRequestLine.findMany({
    where: {
      partId: { not: null },
      request: { organizationId: user.organizationId, estado: { in: ESTADOS_COMPRA_ABIERTA } },
    },
    select: { partId: true, request: { select: { id: true, folio: true, estado: true } } },
  });
  const foliosPorParte = new Map<string, string[]>();
  // Con el id, no solo el folio: al dar entrada se ofrece ir a recibir ESA
  // compra, que es donde la entrada queda ligada a su documento.
  const comprasPorParte = new Map<string, Array<{ id: string; folio: string }>>();
  for (const l of enCamino) {
    const previos = foliosPorParte.get(l.partId!) ?? [];
    if (!previos.includes(l.request.folio)) previos.push(l.request.folio);
    foliosPorParte.set(l.partId!, previos);
    // Solo las que ya se colocaron: una requisicion sin orden todavia no tiene
    // material en camino que recibir.
    if (["EN_COMPRA", "RECIBIDA_PARCIAL"].includes(l.request.estado)) {
      const lista = comprasPorParte.get(l.partId!) ?? [];
      if (!lista.some((c) => c.id === l.request.id)) lista.push({ id: l.request.id, folio: l.request.folio });
      comprasPorParte.set(l.partId!, lista);
    }
  }
  for (const f of filas) {
    f.enCompra = foliosPorParte.get(f.id) ?? [];
    f.comprasPorRecibir = comprasPorParte.get(f.id) ?? [];
  }

  const bajoMinimoSinPedir = filas.filter((f) => estaBajoMinimo(f) && !f.enCompra?.length).length;
  const lowCount = filas.filter((f) => estaBajoMinimo(f)).length;
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
            <LineChart className="h-3.5 w-3.5" /> Análisis
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
          <span className="mr-1 text-[0.6875rem] font-medium uppercase tracking-wide text-slate-500">Almacén</span>
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

      {franja ? (
        <FranjaPlegable resumen={resumenDeLaFranja(franja)}>
          <FranjaAlmacen franja={franja} moneda={currency} />
        </FranjaPlegable>
      ) : null}

      {params.categoria ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
          <span>Viendo solo la familia <strong>{params.categoria}</strong>.</span>
          <Link href="/inventory" className="font-medium underline">Ver todas</Link>
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="SKU activos" value={parts.length} />
        <Stat
          label="Bajo mínimo"
          value={lowCount}
          tone={bajoMinimoSinPedir ? "warn" : "good"}
          hint={lowCount && lowCount !== bajoMinimoSinPedir ? `${lowCount - bajoMinimoSinPedir} ya vienen en camino` : undefined}
        />
        <Stat label="Sin existencia" value={outOfStock} tone={outOfStock ? "bad" : "good"} />
        {verCostosDeAlmacen(user.role) ? <Stat label="Valor del inventario" value={formatCurrency(inventoryValue, currency)} /> : null}
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={params.q ?? ""} className="field max-w-64" placeholder="Buscar refaccion…" />
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" name="low" value="1" defaultChecked={params.low === "1"} className="h-4 w-4 rounded border-slate-300" />
          Solo bajo mínimo
        </label>
        <button type="submit" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
          Filtrar
        </button>
        {can(user.role, "data:export") ? (
          <a href="/api/export/inventory" className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
            Exportar CSV
          </a>
        ) : null}
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
          conCostos={verCostosDeAlmacen(user.role)}
        />
      )}

    </>
  );
}
