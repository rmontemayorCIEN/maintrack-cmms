import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";
import { vistaGuardada } from "@/lib/vistas";
import { TablaKardex, TIPOS, type FilaKardex } from "./tabla-kardex";

export const metadata = { title: "Kardex de almacen" };
export const dynamic = "force-dynamic";

/** Los que suman existencia. El resto resta, salvo el ajuste que fija. */
const SUMAN = ["IN", "RETURN", "TRANSFER_IN"];

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function KardexPage({
  searchParams,
}: {
  searchParams: Promise<{ parte?: string; almacen?: string; tipo?: string; desde?: string; hasta?: string }>;
}) {
  const user = await requireUser();
  const orgId = user.organizationId;
  const params = await searchParams;
  const moneda = user.organization.currency;

  // Por omision el ultimo mes: un kardex sin ventana trae anos de movimientos
  // y tarda en cargar sin que nadie lo haya pedido.
  const hoy = new Date();
  const haceUnMes = new Date(hoy); haceUnMes.setDate(haceUnMes.getDate() - 30);
  const desde = params.desde ? new Date(`${params.desde}T00:00:00`) : haceUnMes;
  const hasta = params.hasta ? new Date(`${params.hasta}T23:59:59`) : hoy;

  const [almacenes, refacciones, movimientos] = await Promise.all([
    prisma.warehouse.findMany({
      where: { organizationId: orgId },
      orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.part.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.stockMovement.findMany({
      where: {
        organizationId: orgId,
        createdAt: { gte: desde, lte: hasta },
        ...(params.parte ? { partId: params.parte } : {}),
        ...(params.almacen ? { warehouseId: params.almacen } : {}),
        ...(params.tipo ? { movementType: params.tipo } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true, movementType: true, quantity: true, unitCost: true, balanceAfter: true,
        reference: true, entregadoA: true, createdAt: true,
        part: { select: { code: true, name: true, unit: true } },
        warehouse: { select: { name: true } },
        user: { select: { name: true } },
        workOrder: { select: { id: true, number: true } },
        materialRequest: { select: { id: true, folio: true } },
        transfer: { select: { id: true, folio: true } },
      },
    }),
  ]);

  const filas: FilaKardex[] = movimientos.map((m) => {
    // El documento que lo origino, en orden de cercania: el vale dice mas que
    // la orden, y la orden mas que nada.
    const documento = m.materialRequest
      ? { texto: m.materialRequest.folio, href: `/requisiciones/${m.materialRequest.id}` }
      : m.transfer
        ? { texto: m.transfer.folio, href: "/inventory/traspasos" }
        : m.workOrder
          ? { texto: m.workOrder.number, href: `/work-orders/${m.workOrder.id}` }
          : null;

    return {
      id: m.id,
      fecha: m.createdAt.toISOString(),
      tipo: m.movementType,
      refaccion: m.part.name, refaccionCodigo: m.part.code, unidad: m.part.unit,
      almacen: m.warehouse?.name ?? null,
      cantidad: m.quantity,
      efecto: m.movementType === "ADJUST" ? 0 : SUMAN.includes(m.movementType) ? 1 : -1,
      saldoDespues: m.balanceAfter,
      costoUnitario: m.unitCost,
      referencia: m.reference,
      entregadoA: m.entregadoA,
      usuario: m.user?.name ?? null,
      documento,
      moneda,
    };
  });

  const entradas = filas.filter((f) => f.efecto > 0);
  const salidas = filas.filter((f) => f.efecto < 0);
  const valorEntradas = entradas.reduce((s, f) => s + f.cantidad * f.costoUnitario, 0);
  const valorSalidas = salidas.reduce((s, f) => s + f.cantidad * f.costoUnitario, 0);

  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const base = { parte: params.parte, almacen: params.almacen, tipo: params.tipo, desde: iso(desde), hasta: iso(hasta), ...extra };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `/inventory/kardex?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Kardex de almacén"
        description="Cada entrada, salida, devolución y traspaso, con el saldo que dejó y el documento que lo originó."
        breadcrumb={
          <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Almacén
          </Link>
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <label className="text-[0.6875rem] font-medium text-slate-600">Refacción</label>
          <select name="parte" defaultValue={params.parte ?? ""} className="mt-0.5 w-56 rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            <option value="">Todas</option>
            {refacciones.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[0.6875rem] font-medium text-slate-600">Almacén</label>
          <select name="almacen" defaultValue={params.almacen ?? ""} className="mt-0.5 rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            <option value="">Todos</option>
            {almacenes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[0.6875rem] font-medium text-slate-600">Movimiento</label>
          <select name="tipo" defaultValue={params.tipo ?? ""} className="mt-0.5 rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
            <option value="">Todos</option>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[0.6875rem] font-medium text-slate-600">Desde</label>
          <input type="date" name="desde" defaultValue={iso(desde)} className="mt-0.5 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
        </div>
        <div>
          <label className="text-[0.6875rem] font-medium text-slate-600">Hasta</label>
          <input type="date" name="hasta" defaultValue={iso(hasta)} className="mt-0.5 rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
        </div>
        <button type="submit" className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
          Aplicar
        </button>
        <Link href="/inventory/kardex" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
          Limpiar
        </Link>
      </form>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Entradas" value={String(entradas.length)} hint={formatCurrency(valorEntradas, moneda)} />
        <Stat label="Salidas" value={String(salidas.length)} hint={formatCurrency(valorSalidas, moneda)} />
        <Stat label="Consumo neto" value={formatCurrency(valorSalidas - valorEntradas, moneda)} />
        <Stat label="Movimientos" value={String(filas.length)} hint={filas.length >= 1000 ? "tope de 1000, acote el rango" : `${iso(desde)} a ${iso(hasta)}`} />
      </div>

      {filas.length === 0 ? (
        <EmptyState
          title="Sin movimientos en el periodo"
          description="Amplíe el rango de fechas o quite los filtros para ver el historial."
        />
      ) : (
        <TablaKardex movimientos={filas} vistaInicial={vistaGuardada(user.vistasTabla, "kardex")} />
      )}

      <p className="mt-3 text-[0.6875rem] text-slate-500">
        El saldo es el del almacén después de ese movimiento, que es contra lo que se cuadra un conteo físico.{" "}
        <Link href={q({ tipo: "ADJUST" })} className="text-brand-600 hover:underline">Ver solo los ajustes</Link> para
        revisar qué se corrigió a mano.
      </p>
    </>
  );
}
