import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { verCostosDeAlmacen } from "@/lib/pantallas";
import { documentoDeMovimiento, quienRecibio } from "@/lib/kardex-datos";
import { ESTADOS_COMPRA, type EstadoCompra } from "@/lib/estados-compra";
import { TIPOS_EQUIVALENCIA } from "@/lib/equivalencias";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { Adjuntos } from "@/components/adjuntos";
import { PasarRegistros } from "@/components/paso-registros";
import { PartDialog } from "../part-dialog";
import { MovementForm } from "../movement-form";

export const dynamic = "force-dynamic";

const SUMAN = ["IN", "RETURN", "TRANSFER_IN"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const parte = await prisma.part.findFirst({ where: { id, organizationId: user.organizationId }, select: { code: true, name: true } });
  return { title: parte ? `${parte.code} — ${parte.name}` : "Refacción" };
}

/**
 * El expediente de una refacción: dónde está, qué ha costado, en qué equipos
 * se ha ido y qué la espera.
 *
 * Antes esta dirección rebotaba a la lista filtrada: para ver el kardex de una
 * pieza había que ir a otra pantalla y volver a buscarla, y no había forma de
 * saber en qué equipos se consumía.
 */
export default async function RefaccionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const zona = user.organization.timezone;
  const moneda = user.organization.currency;
  const editable = can(user.role, "inventory:write");
  const verCostos = verCostosDeAlmacen(user.role);

  const parte = await prisma.part.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      supplier: { select: { id: true, name: true } },
      existencias: { select: { quantity: true, minQuantity: true, maxQuantity: true, bin: true, warehouse: { select: { id: true, code: true, name: true } } } },
      attachments: {
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, kind: true, size: true, mimeType: true, createdAt: true, uploadedBy: { select: { name: true } } },
      },
      links: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, url: true, note: true, createdAt: true } },
    },
  });
  if (!parte) notFound();

  const [movimientos, planes, compras, esperando, equivalencias, proveedores, familias, unidades] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { organizationId: user.organizationId, partId: parte.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true, movementType: true, quantity: true, unitCost: true, balanceAfter: true, reference: true, entregadoA: true, createdAt: true,
        warehouse: { select: { name: true } }, user: { select: { name: true } },
        workOrder: { select: { id: true, number: true, asset: { select: { code: true, name: true } } } },
        materialRequest: { select: { id: true, folio: true } },
        transfer: { select: { id: true, folio: true } },
        goodsReceipt: { select: { id: true, folio: true, purchaseRequest: { select: { id: true, folio: true } }, recibidoPor: { select: { name: true } } } },
      },
    }),
    prisma.planTaskPart.findMany({
      where: { part: { id: parte.id } },
      select: { quantity: true, task: { select: { title: true, plan: { select: { id: true, name: true, active: true } } } } },
    }),
    prisma.purchaseRequestLine.findMany({
      where: { partId: parte.id, request: { organizationId: user.organizationId } },
      orderBy: { request: { createdAt: "desc" } },
      take: 10,
      select: {
        cantidadSolicitada: true, cantidadRecibida: true, costoEstimado: true,
        request: { select: { id: true, folio: true, estado: true, createdAt: true } },
      },
    }),
    prisma.workOrderTask.findMany({
      where: { bloqueadaPorPartId: parte.id, workOrder: { organizationId: user.organizationId, status: { notIn: ["CLOSED", "CANCELLED"] } } },
      select: { title: true, workOrder: { select: { id: true, number: true, status: true, asset: { select: { code: true } } } } },
    }),
    prisma.equivalenciaRefaccion.findMany({
      where: { organizationId: user.organizationId, OR: [{ partAId: parte.id }, { partBId: parte.id }] },
      select: { id: true, tipo: true, nota: true, partA: { select: { id: true, code: true, name: true } }, partB: { select: { id: true, code: true, name: true } } },
    }),
    prisma.supplier.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.partCategory.findMany({ where: { organizationId: user.organizationId }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.partUnit.findMany({ where: { organizationId: user.organizationId }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
  ]);

  // El consumo por equipo sale de las salidas con orden de trabajo: es el dato
  // que contesta «¿a quién se le va esta pieza?».
  const salidas = await prisma.stockMovement.findMany({
    where: { organizationId: user.organizationId, partId: parte.id, movementType: "OUT", workOrder: { assetId: { not: null } } },
    select: { quantity: true, unitCost: true, createdAt: true, workOrder: { select: { assetId: true, asset: { select: { code: true, name: true } } } } },
  });
  const porEquipo = [...salidas.reduce((m, s) => {
    const k = s.workOrder!.assetId!;
    const actual = m.get(k) ?? { code: s.workOrder!.asset!.code, name: s.workOrder!.asset!.name, cantidad: 0, costo: 0, ultima: s.createdAt, id: k };
    actual.cantidad += s.quantity;
    actual.costo += s.quantity * s.unitCost;
    if (s.createdAt > actual.ultima) actual.ultima = s.createdAt;
    return m.set(k, actual);
  }, new Map<string, { id: string; code: string; name: string; cantidad: number; costo: number; ultima: Date }>()).values()].sort((a, b) => b.cantidad - a.cantidad);

  const doceMeses = new Date(Date.now() - 365 * 86_400_000);
  const consumoAnual = salidas.filter((s) => s.createdAt >= doceMeses).reduce((t, s) => t + s.quantity, 0);
  const enAlmacenes = parte.existencias.reduce((t, e) => t + e.quantity, 0);
  const enCamino = compras.filter((c) => ["SOLICITADA", "AUTORIZADA", "EN_COMPRA", "RECIBIDA_PARCIAL"].includes(c.request.estado))
    .reduce((t, c) => t + (c.cantidadSolicitada - c.cantidadRecibida), 0);
  const bajoMinimo = parte.minQuantity > 0 && enAlmacenes <= parte.minQuantity;

  return (
    <>
      <PageHeader
        title={`${parte.code} — ${parte.name}`}
        breadcrumb={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-brand-600">
              <ArrowLeft className="h-3 w-3" /> Almacén
            </Link>
            <PasarRegistros base="/inventory" id={parte.id} />
          </span>
        }
        description={parte.description ?? undefined}
        actions={
          <>
            <Link href={`/inventory/kardex?parte=${parte.id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <BookOpen className="h-3.5 w-3.5" /> Kardex completo
            </Link>
            {editable ? (
              <PartDialog
                suppliers={proveedores}
                familias={familias}
                unidades={unidades}
                puedeGestionarCatalogos={can(user.role, "settings:write")}
                refaccion={{
                  id: parte.id, code: parte.code, name: parte.name, description: parte.description, category: parte.category,
                  unit: parte.unit, unitCost: parte.unitCost, minQuantity: parte.minQuantity, maxQuantity: parte.maxQuantity,
                  bin: parte.bin, supplierId: parte.supplierId,
                }}
              />
            ) : null}
          </>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Existencia" value={`${formatNumber(enAlmacenes, 2)} ${parte.unit}`} tone={bajoMinimo ? "bad" : "good"}
          hint={parte.minQuantity > 0 ? `Mínimo ${formatNumber(parte.minQuantity, 2)}${parte.maxQuantity > 0 ? ` · máximo ${formatNumber(parte.maxQuantity, 2)}` : ""}` : "Sin mínimo definido"} />
        {verCostos ? <Stat label="Costo promedio" value={formatCurrency(parte.unitCost, moneda)} hint={`Valor en almacén: ${formatCurrency(enAlmacenes * parte.unitCost, moneda)}`} /> : null}
        <Stat label="Consumo (12 meses)" value={`${formatNumber(consumoAnual, 2)} ${parte.unit}`} hint={porEquipo.length ? `${porEquipo.length} equipo(s)` : "Todavía sin consumo"} />
        <Stat label="En camino" value={`${formatNumber(enCamino, 2)} ${parte.unit}`} tone={enCamino > 0 ? "warn" : "default"} hint={enCamino > 0 ? "Compras abiertas" : "Sin compras abiertas"} />
      </div>

      {esperando.length ? (
        <div role="note" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Detiene trabajo: </strong>
          {esperando.map((t) => (
            <Link key={t.workOrder.id} href={`/work-orders/${t.workOrder.id}`} className="underline underline-offset-2">
              {t.workOrder.number}{t.workOrder.asset ? ` · ${t.workOrder.asset.code}` : ""}
            </Link>
          )).reduce<React.ReactNode[]>((acc, x, i) => (i ? [...acc, ", ", x] : [x]), [])}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader title="Existencia por almacén" subtitle="Dónde está y cuánto hay en cada lugar." />
            <div className="table-wrap">
              <table className="data w-full text-sm">
                <thead><tr><th>Almacén</th><th className="text-right">Cantidad</th><th className="text-right">Mínimo</th><th>Ubicación</th></tr></thead>
                <tbody>
                  {parte.existencias.map((e) => (
                    <tr key={e.warehouse.id}>
                      <td>{e.warehouse.code} · {e.warehouse.name}</td>
                      <td className="text-right tabular-nums">{formatNumber(e.quantity, 2)}</td>
                      <td className="text-right tabular-nums">{e.minQuantity !== null ? formatNumber(e.minQuantity, 2) : "—"}</td>
                      <td>{e.bin ?? parte.bin ?? "—"}</td>
                    </tr>
                  ))}
                  {parte.existencias.length === 0 ? <tr><td colSpan={4} className="text-slate-500">Todavía no tiene existencia en ningún almacén.</td></tr> : null}
                </tbody>
              </table>
            </div>
            {editable ? <div className="mt-3"><MovementForm partId={parte.id} unit={parte.unit} /></div> : null}
          </Card>

          <Card>
            <CardHeader title="Últimos movimientos" subtitle="Entradas, salidas y ajustes, con el documento que los originó." action={<Link href={`/inventory/kardex?parte=${parte.id}`} className="text-xs font-medium text-brand-600 hover:underline">Ver todo</Link>} />
            <div className="table-wrap">
              <table className="data w-full text-sm">
                <thead><tr><th>Fecha</th><th>Tipo</th><th className="text-right">Cantidad</th><th className="text-right">Saldo</th><th>Documento</th><th>Quién</th></tr></thead>
                <tbody>
                  {movimientos.map((m) => {
                    const doc = documentoDeMovimiento(m);
                    const signo = m.movementType === "ADJUST" ? "" : SUMAN.includes(m.movementType) ? "+" : "−";
                    return (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap">{formatDate(m.createdAt, zona)}</td>
                        <td>{m.movementType}{m.warehouse ? ` · ${m.warehouse.name}` : ""}</td>
                        <td className="text-right tabular-nums">{signo}{formatNumber(m.quantity, 2)}</td>
                        <td className="text-right tabular-nums">{formatNumber(m.balanceAfter, 2)}</td>
                        <td>{doc ? <Link href={doc.href} className="text-brand-600 hover:underline">{doc.texto}</Link> : m.reference ?? "—"}</td>
                        <td>{quienRecibio(m) ?? m.user?.name ?? "—"}</td>
                      </tr>
                    );
                  })}
                  {movimientos.length === 0 ? <tr><td colSpan={6} className="text-slate-500">Sin movimientos todavía.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="En qué equipos se ha ido" subtitle="Consumo registrado en órdenes de trabajo." />
            {porEquipo.length ? (
              <div className="table-wrap">
                <table className="data w-full text-sm">
                  <thead><tr><th>Equipo</th><th className="text-right">Cantidad</th>{verCostos ? <th className="text-right">Costo</th> : null}<th>Última vez</th></tr></thead>
                  <tbody>
                    {porEquipo.map((e) => (
                      <tr key={e.id}>
                        <td><Link href={`/assets/${e.id}`} className="text-brand-600 hover:underline">{e.code}</Link> · {e.name}</td>
                        <td className="text-right tabular-nums">{formatNumber(e.cantidad, 2)} {parte.unit}</td>
                        {verCostos ? <td className="text-right tabular-nums">{formatCurrency(e.costo, moneda)}</td> : null}
                        <td>{formatDate(e.ultima, zona)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-slate-500">Todavía no se ha consumido en ninguna orden.</p>}
          </Card>

          <Card>
            <CardHeader title="Compras" subtitle="Lo que se ha pedido de esta pieza y en qué va." />
            {compras.length ? (
              <div className="table-wrap">
                <table className="data w-full text-sm">
                  <thead><tr><th>Folio</th><th>Estado</th><th className="text-right">Pedido</th><th className="text-right">Recibido</th>{verCostos ? <th className="text-right">Costo estimado</th> : null}<th>Fecha</th></tr></thead>
                  <tbody>
                    {compras.map((c) => (
                      <tr key={c.request.id}>
                        <td><Link href={`/compras/${c.request.id}`} className="text-brand-600 hover:underline">{c.request.folio}</Link></td>
                        <td><Badge tone={c.request.estado === "RECIBIDA" || c.request.estado === "CERRADA" ? "success" : c.request.estado === "RECHAZADA" || c.request.estado === "CANCELADA" ? "danger" : "warning"}>{ESTADOS_COMPRA[c.request.estado as EstadoCompra] ?? c.request.estado}</Badge></td>
                        <td className="text-right tabular-nums">{formatNumber(c.cantidadSolicitada, 2)}</td>
                        <td className="text-right tabular-nums">{formatNumber(c.cantidadRecibida, 2)}</td>
                        {verCostos ? <td className="text-right tabular-nums">{formatCurrency(c.costoEstimado, moneda)}</td> : null}
                        <td>{formatDate(c.request.createdAt, zona)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-slate-500">Todavía no se ha comprado por MainTrack.</p>}
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader title="Ficha" />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Clave</dt><dd className="font-mono text-xs">{parte.code}</dd>
              <dt className="text-slate-500">Unidad</dt><dd>{parte.unit}</dd>
              <dt className="text-slate-500">Familia</dt><dd>{parte.category ?? "—"}</dd>
              <dt className="text-slate-500">Proveedor habitual</dt>
              <dd>{parte.supplier ? <Link href="/suppliers" className="text-brand-600 hover:underline">{parte.supplier.name}</Link> : "—"}</dd>
              <dt className="text-slate-500">Ubicación</dt><dd>{parte.bin ?? "—"}</dd>
              <dt className="text-slate-500">Estado</dt><dd>{parte.active ? "Activa" : "Inactiva"}</dd>
              <dt className="text-slate-500">Alta</dt><dd>{formatDateTime(parte.createdAt, zona)}</dd>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Planes que la consumen" subtitle="Preventivos que la piden en alguna actividad." />
            {planes.length ? (
              <ul className="grid gap-1.5 text-sm">
                {planes.map((p, i) => (
                  <li key={i}>
                    <Link href={`/plans/${p.task.plan.id}`} className="font-medium text-brand-600 hover:underline">{p.task.plan.name}</Link>
                    {p.task.plan.active ? "" : " (pausado)"} · {formatNumber(p.quantity, 2)} {parte.unit} en «{p.task.title}»
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">Ningún plan la pide todavía.</p>}
          </Card>

          <Card>
            <CardHeader title="Equivalentes" subtitle="Piezas que pueden sustituirla." action={<Link href="/inventory/equivalencias" className="text-xs font-medium text-brand-600 hover:underline">Administrar</Link>} />
            {equivalencias.length ? (
              <ul className="grid gap-1.5 text-sm">
                {equivalencias.map((e) => {
                  const otra = e.partA.id === parte.id ? e.partB : e.partA;
                  return (
                    <li key={e.id}>
                      <Link href={`/inventory/${otra.id}`} className="font-medium text-brand-600 hover:underline">{otra.code}</Link> · {otra.name}
                      <span className="text-slate-500"> — {TIPOS_EQUIVALENCIA[e.tipo as keyof typeof TIPOS_EQUIVALENCIA] ?? e.tipo}{e.nota ? `: ${e.nota}` : ""}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-slate-500">Sin equivalentes registrados.</p>}
          </Card>

          <Adjuntos
            destino={{ partId: parte.id }}
            adjuntos={parte.attachments.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), subidoPor: a.uploadedBy?.name ?? null }))}
            editable={editable}
            titulo="Fichas técnicas y fotos"
            ayuda="La ficha del fabricante, la foto de la pieza o la cotización: lo que ayude a pedir la correcta."
          />
        </div>
      </div>
    </>
  );
}
