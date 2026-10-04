import { MAINTENANCE_TYPE_LABELS } from "@/lib/constants";
import { Compromisos } from "@/components/compromisos";
import { Comentarios } from "@/components/comentarios";
import { cubiertoPorCompras } from "@/lib/compras";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, PageHeader } from "@/components/ui";
import { CONSUMO_GENERAL, ESTADOS, MOTIVOS, SIN_ACTIVIDAD, URGENCIAS } from "@/lib/requisiciones-datos";
import { tipoDeActividad } from "@/lib/fallas";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { AccionesRequisicion, type RenglonVale } from "./acciones";
import { CompraDialog } from "../../compras/compra-dialog";
import { PasarRegistros } from "@/components/paso-registros";

export const dynamic = "force-dynamic";

const TONO_ESTADO: Record<string, "muted" | "info" | "success" | "warning" | "danger"> = {
  SOLICITADA: "warning", PARCIAL: "info", SURTIDA: "success", CERRADA: "muted", CANCELADA: "danger",
};

export default async function RequisicionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const req = await prisma.materialRequest.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      warehouse: { select: { id: true, name: true } },
      solicitante: { select: { name: true } },
      workOrder: { select: { id: true, number: true, title: true, maintenanceType: true } },
      asset: { select: { id: true, code: true, name: true } },
      renglones: {
        include: {
          part: { select: { id: true, code: true, unit: true, unitCost: true } },
          task: { select: { id: true, title: true, maintenanceType: true } },
        },
      },
      movements: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, movementType: true, quantity: true, entregadoA: true, createdAt: true,
          part: { select: { code: true, unit: true } },
          user: { select: { name: true } },
        },
      },
    },
  });
  if (!req) notFound();

  // La existencia se lee del almacen de la requisicion: es de ahi de donde va
  // a salir, no del total de la cuenta.
  const conParte = req.renglones.filter((r) => r.partId).map((r) => r.partId!);
  const existencias = conParte.length
    ? new Map(
        (await prisma.partStock.findMany({
          where: { warehouseId: req.warehouseId, partId: { in: conParte } },
          select: { partId: true, quantity: true },
        })).map((e) => [e.partId, e.quantity]),
      )
    : new Map<string, number>();

  const [almacenes, refaccionesCatalogo, proveedores] = await Promise.all([
    prisma.warehouse.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.part.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, unit: true, unitCost: true },
    }),
    prisma.supplier.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const renglones: RenglonVale[] = req.renglones.map((r) => ({
    id: r.id,
    descripcion: r.descripcion,
    unidad: r.part?.unit ?? "pza",
    solicitada: r.cantidadSolicitada,
    surtida: r.cantidadSurtida,
    devuelta: r.cantidadDevuelta,
    disponible: r.partId ? existencias.get(r.partId) ?? 0 : null,
    // Una refaccion sin costo entra a la orden en cero y el costo por equipo
    // sale corto. Se avisa aqui, que es donde alguien puede capturarlo.
    sinCosto: !!r.partId && (r.part?.unitCost ?? 0) <= 0,
    // De qué actividad es este material. Sin actividad puede ser consumo
    // general de la orden o un vale anterior a que se guardara: no se adivina.
    actividad: r.task?.title ?? null,
    tipoActividad: r.task ? tipoDeActividad(r.task.maintenanceType, req.workOrder?.maintenanceType ?? "") : null,
  }));
  const sinCosto = renglones.filter((r) => r.sinCosto);

  // Lo que el almacen no puede cubrir: o no esta en catalogo, o no alcanza la
  // existencia. Es exactamente lo que tiene que ir a compras.
  // Lo que ya esta en una compra viva no se vuelve a mandar: se descuenta del
  // faltante y se dice en que folio va.
  const yaEnCompra = await cubiertoPorCompras(user.organizationId, req.id);
  const faltantes = renglones
    .map((r) => {
      const pendiente = r.solicitada - r.surtida;
      if (pendiente <= 0.0001) return null;
      const cubre = r.disponible === null ? 0 : Math.min(pendiente, r.disponible);
      const comprado = yaEnCompra.get(r.id)?.cantidad ?? 0;
      const falta = pendiente - cubre - comprado;
      if (falta <= 0.0001) return null;
      const original = req.renglones.find((x) => x.id === r.id);
      return { partId: original?.partId ?? null, descripcion: r.descripcion, cantidad: falta, materialRequestLineId: r.id };
    })
    .filter(Boolean) as Array<{ partId: string | null; descripcion: string; cantidad: number; materialRequestLineId: string }>;
  const enCompraTexto = [...yaEnCompra.values()].flatMap((v) => v.folios);

  const destino = req.workOrder
    ? { texto: `${req.workOrder.number} · ${req.workOrder.title}`, href: `/work-orders/${req.workOrder.id}` }
    : req.asset
      ? { texto: `${req.asset.code} · ${req.asset.name}`, href: `/assets/${req.asset.id}` }
      : null;

  return (
    <>
      <PageHeader
        title={`Requisición ${req.folio}`}
        description={`${MOTIVOS[req.motivo as keyof typeof MOTIVOS] ?? req.motivo} · almacén ${req.warehouse.name}`}
        breadcrumb={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/requisiciones" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Requisiciones
          </Link>
            <PasarRegistros base="/requisiciones" id={id} />
          </span>
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Badge tone={TONO_ESTADO[req.estado] ?? "muted"}>{ESTADOS[req.estado as keyof typeof ESTADOS] ?? req.estado}</Badge>
            {req.urgencia !== "NORMAL" ? (
              <Badge tone={req.urgencia === "PARO" ? "danger" : "warning"}>
                {URGENCIAS[req.urgencia as keyof typeof URGENCIAS]}
              </Badge>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-4">
          <Card padded={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Refacción</th>
                    <th className="text-right">Pedido</th>
                    <th className="text-right">Surtido</th>
                    <th className="text-right">Devuelto</th>
                    <th className="text-right">Por surtir</th>
                    <th className="text-right">En almacén</th>
                  </tr>
                </thead>
                <tbody>
                  {renglones.map((r) => {
                    const falta = r.solicitada - r.surtida;
                    return (
                      <tr key={r.id}>
                        <td>
                          <p className="font-medium text-slate-800">{r.descripcion}</p>
                          <p className="text-[0.625rem] text-slate-500">
                            {r.actividad
                              ? <>Para: {r.actividad} · <span className="text-slate-600">{MAINTENANCE_TYPE_LABELS[r.tipoActividad ?? ""] ?? ""}</span></>
                              : req.workOrderId
                                ? CONSUMO_GENERAL
                                : SIN_ACTIVIDAD}
                          </p>
                          {r.disponible === null ? (
                            <p className="text-[0.625rem] text-amber-700">No está en el catálogo — va a compras</p>
                          ) : null}
                        </td>
                        <td className="text-right tabular-nums text-xs text-slate-700">{formatNumber(r.solicitada, 2)}</td>
                        <td className="text-right tabular-nums text-xs text-slate-600">{formatNumber(r.surtida, 2)}</td>
                        <td className="text-right tabular-nums text-xs text-slate-600">
                          {r.devuelta ? formatNumber(r.devuelta, 2) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right tabular-nums text-xs">
                          {falta > 0.0001 ? <span className="font-medium text-amber-700">{formatNumber(falta, 2)}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right tabular-nums text-xs text-slate-500">
                          {r.disponible === null ? "—" : formatNumber(r.disponible, 2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {faltantes.length && can(user.role, "purchase:request") ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-xs font-semibold text-amber-900">
                {faltantes.length === 1 ? "Un renglón no se puede surtir" : `${faltantes.length} renglones no se pueden surtir`}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-amber-800">
                No hay existencia suficiente en {req.warehouse.name}, o la refacción todavía no está
                en el catálogo. Lo que falta se puede mandar a compras sin volver a capturarlo.
              </p>
              {enCompraTexto.length ? (
                <p className="mt-0.5 text-[0.6875rem] text-amber-800">
                  Ya hay compra abierta para parte de este vale ({[...new Set(enCompraTexto)].join(", ")}): esa
                  cantidad ya no aparece aquí para no comprarla dos veces.
                </p>
              ) : null}
              <div className="mt-2">
                <CompraDialog
                  moneda={user.organization.currency}
                  almacenes={almacenes}
                  refacciones={refaccionesCatalogo.map((r) => ({ id: r.id, code: r.code, name: r.name, unit: r.unit, costo: r.unitCost }))}
                  proveedores={proveedores}
                  materialRequestId={req.id}
                  precargados={faltantes}
                  etiqueta="Solicitar a compras"
                />
              </div>
            </div>
          ) : null}

          {sinCosto.length ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[0.6875rem] text-slate-600">
              <span className="font-semibold text-slate-700">Costo pendiente: </span>
              {sinCosto.map((r) => r.descripcion).join(", ")} no tiene costo capturado. Se puede surtir,
              pero el consumo entra en $0 y el costo del equipo sale corto. Captúrelo en Almacén.
            </div>
          ) : null}

          <AccionesRequisicion
            requestId={req.id}
            estado={req.estado}
            renglones={renglones}
            puedeSurtir={can(user.role, "inventory:write")}
            solicitante={req.solicitante?.name ?? ""}
          />
        </div>

        <div className="grid gap-4">
          <Card>
            <p className="text-xs font-semibold text-slate-800">Datos</p>
            <dl className="mt-2 grid gap-1.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Solicitó</dt>
                <dd className="text-right text-slate-800">{req.solicitante?.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Pedida</dt>
                <dd className="text-right text-slate-800">{formatDateTime(req.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Destino</dt>
                <dd className="text-right">
                  {destino ? <Link href={destino.href} className="text-brand-600 hover:underline">{destino.texto}</Link> : "—"}
                </dd>
              </div>
              {req.cerradaEl ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Cerrada</dt>
                  <dd className="text-right text-slate-800">{formatDateTime(req.cerradaEl)}</dd>
                </div>
              ) : null}
            </dl>
            {req.nota ? <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">{req.nota}</p> : null}
          </Card>

          <Card>
            <p className="text-xs font-semibold text-slate-800">Vale — movimientos</p>
            <p className="mt-0.5 text-[0.6875rem] text-slate-500">
              Cada entrega y cada devolución, con su fecha y quién la recibió.
            </p>
            {req.movements.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">Todavía no sale nada del almacén.</p>
            ) : (
              <ul className="mt-2 grid gap-1.5">
                {req.movements.map((m) => (
                  <li key={m.id} className="border-b border-slate-100 pb-1.5 last:border-0 last:pb-0">
                    <p className="text-xs text-slate-800">
                      <Badge tone={m.movementType === "RETURN" ? "info" : "muted"}>
                        {m.movementType === "RETURN" ? "Devolución" : "Salida"}
                      </Badge>{" "}
                      <span className="tabular-nums font-medium">{formatNumber(m.quantity, 2)}</span> {m.part.unit} · {m.part.code}
                    </p>
                    <p className="text-[0.625rem] text-slate-500">
                      {formatDateTime(m.createdAt)}
                      {m.entregadoA ? ` · ${m.movementType === "RETURN" ? "devolvió" : "recibió"} ${m.entregadoA}` : ""}
                      {m.user?.name ? ` · registró ${m.user.name}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Lo que se hable de este registro queda aquí, no en un chat
          suelto donde se pierde en veinte minutos. */}
      <div className="mt-4">
        <Comentarios ancla="materialRequest" anclaId={req.id} yo={user.id} zona={user.organization.timezone} titulo="Conversación de la requisición" />
      </div>

      {/* Lo que se acordó y no es una orden de trabajo. */}
      <div className="mt-4">
        <Compromisos entidad="MaterialRequest" entidadId={req.id} yo={user.id} zona={user.organization.timezone} />
      </div>
    </>
  );
}
