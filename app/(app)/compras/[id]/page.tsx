import Link from "next/link";
import { Compromisos } from "@/components/compromisos";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ESTADOS_COMPRA, quienAutorizo } from "@/lib/estados-compra";
import { URGENCIAS } from "@/lib/requisiciones-datos";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/utils";
import { costosVigentes } from "@/lib/compras";
import { AccionesCompra, type RenglonCompra } from "./acciones";
import { Comparativo, type Cotizacion } from "./comparativo";
import { PasarRegistros } from "@/components/paso-registros";

export const dynamic = "force-dynamic";

const TONO: Record<string, "muted" | "info" | "success" | "warning" | "danger"> = {
  SOLICITADA: "warning", AUTORIZADA: "info", RECHAZADA: "danger", EN_COMPRA: "info",
  RECIBIDA_PARCIAL: "info", RECIBIDA: "success", CERRADA: "muted", CANCELADA: "danger",
};

export default async function CompraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const moneda = user.organization.currency;

  const [compra, proveedores] = await Promise.all([
    prisma.purchaseRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        warehouse: { select: { name: true } },
        solicitante: { select: { name: true } },
        autorizadaPor: { select: { name: true } },
        proveedorSugerido: { select: { name: true } },
        materialRequest: { select: { id: true, folio: true } },
        renglones: { include: { part: { select: { unit: true } } } },
        cotizaciones: {
          orderBy: { total: "asc" },
          include: {
            supplier: { select: { id: true, name: true } },
            capturadaPor: { select: { name: true } },
            renglones: true,
          },
        },
        ordenes: {
          orderBy: { createdAt: "desc" },
          select: { id: true, folio: true, total: true, fechaPrometida: true, supplier: { select: { name: true } } },
        },
        recepciones: {
          orderBy: { createdAt: "asc" },
          include: {
            supplier: { select: { name: true } },
            recibidoPor: { select: { name: true } },
            renglones: { include: { part: { select: { code: true, unit: true } } } },
          },
        },
      },
    }),
    prisma.supplier.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, leadTimeDays: true },
    }),
  ]);
  if (!compra) notFound();

  const renglones: RenglonCompra[] = compra.renglones.map((r) => ({
    id: r.id, partId: r.partId, descripcion: r.descripcion,
    solicitada: r.cantidadSolicitada, recibida: r.cantidadRecibida,
    costoEstimado: r.costoEstimado, unidad: r.part?.unit ?? "pza",
  }));

  const cotizaciones: Cotizacion[] = compra.cotizaciones.map((q) => ({
    id: q.id, proveedor: q.supplier.name, proveedorId: q.supplier.id,
    folioProveedor: q.folioProveedor,
    diasEntrega: q.diasEntrega, condicionesPago: q.condicionesPago, garantia: q.garantia,
    vigenciaHasta: q.vigenciaHasta?.toISOString() ?? null,
    total: q.total, seleccionada: q.seleccionada, motivoSeleccion: q.motivoSeleccion, nota: q.nota,
    capturadaPor: q.capturadaPor?.name ?? null,
    createdAt: q.createdAt.toISOString(),
    renglones: q.renglones.map((l) => ({
      requestLineId: l.requestLineId, descripcion: l.descripcion, marca: l.marca,
      cantidad: l.cantidad, costoUnitario: l.costoUnitario, disponible: l.disponible,
    })),
  }));
  const orden = compra.ordenes[0] ?? null;

  // Una sola decision sobre que cifra vale hoy, para que la tabla sume el
  // total del encabezado en vez de contradecirlo (ver costosVigentes).
  const vigentes = costosVigentes(renglones, cotizaciones);
  const totalVigente = renglones.reduce((suma, r) => {
    const v = vigentes.porRenglon.get(r.id)!;
    return v.fuera ? suma : suma + r.solicitada * v.costo;
  }, 0);
  const hayFuera = renglones.some((r) => vigentes.porRenglon.get(r.id)!.fuera);

  const recibidoReal = compra.recepciones.reduce(
    (s, rec) => s + rec.renglones.reduce((t, l) => t + l.cantidad * l.costoUnitario, 0), 0,
  );

  return (
    <>
      <PageHeader
        title={`Compra ${compra.folio}`}
        description={`Entra al almacén ${compra.warehouse.name} · ${vigentes.base} ${formatCurrency(compra.montoEstimado, moneda)}`}
        breadcrumb={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/compras" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Compras
          </Link>
            <PasarRegistros base="/compras" id={id} />
          </span>
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Badge tone={TONO[compra.estado] ?? "muted"}>
              {ESTADOS_COMPRA[compra.estado as keyof typeof ESTADOS_COMPRA] ?? compra.estado}
            </Badge>
            {compra.urgencia !== "NORMAL" ? (
              <Badge tone={compra.urgencia === "PARO" ? "danger" : "warning"}>
                {URGENCIAS[compra.urgencia as keyof typeof URGENCIAS]}
              </Badge>
            ) : null}
          </div>
        }
      />

      {compra.motivoRechazo ? (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          <strong>Rechazada:</strong> {compra.motivoRechazo}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-4">
          <Card padded={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Qué se pide</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-right">Recibido</th>
                    <th className="text-right">Por recibir</th>
                    <th className="text-right">{vigentes.base === "cotizado" ? "Costo cotiz." : "Costo est."}</th>
                    <th className="text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {renglones.map((r) => {
                    const falta = r.solicitada - r.recibida;
                    const vigente = vigentes.porRenglon.get(r.id)!;
                    return (
                      <tr key={r.id}>
                        <td>
                          <p className="font-medium text-slate-800">{r.descripcion}</p>
                          {!r.partId ? (
                            <p className="text-[0.625rem] text-amber-700">
                              Todavía no está en el catálogo — désela de alta antes de recibirla
                            </p>
                          ) : null}
                        </td>
                        <td className="text-right tabular-nums text-xs text-slate-700">{formatNumber(r.solicitada, 2)}</td>
                        <td className="text-right tabular-nums text-xs text-slate-600">{formatNumber(r.recibida, 2)}</td>
                        <td className="text-right tabular-nums text-xs">
                          {falta > 0.0001 ? <span className="font-medium text-amber-700">{formatNumber(falta, 2)}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right tabular-nums text-xs text-slate-600">{formatCurrency(vigente.costo, moneda)}</td>
                        <td className="text-right tabular-nums text-xs text-slate-700">
                          {vigente.fuera ? (
                            <span className="text-amber-700">No lo surte</span>
                          ) : (
                            formatCurrency(r.solicitada * vigente.costo, moneda)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={5} className="text-right text-xs font-medium text-slate-600">
                      Total {vigentes.base}
                      {hayFuera ? " (sin lo que el proveedor no surte)" : ""}
                    </th>
                    <td className="text-right tabular-nums text-xs font-semibold text-slate-800">
                      {formatCurrency(totalVigente, moneda)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/*
            Con el proceso interno apagado tambien se muestran las cotizaciones
            que ya existan, solo que sin poder capturar ni elegir. Apagar la
            bandera nunca borro las cotizaciones —ninguna funcion de negocio la
            mira— y una cotizacion elegida manda sobre el monto de la
            requisicion: ocultarla dejaba en pantalla un total que nada
            explicaba.
          */}
          {user.organization.comprasInternas || cotizaciones.length ? (
            <Comparativo
              compraId={compra.id}
              estado={compra.estado}
              renglones={renglones.map((r) => ({
                id: r.id, partId: r.partId, descripcion: r.descripcion,
                cantidad: r.solicitada, unidad: r.unidad,
              }))}
              cotizaciones={cotizaciones}
              proveedores={proveedores}
              moneda={moneda}
              editable={user.organization.comprasInternas && can(user.role, "purchase:request")}
              ordenEmitida={orden?.folio ?? null}
            />
          ) : null}

          <AccionesCompra
            compraId={compra.id}
            estado={compra.estado}
            renglones={renglones}
            proveedores={proveedores}
            ordenCompra={compra.ordenCompra}
            esPropia={compra.solicitanteId === user.id}
            puedeAutorizar={can(user.role, "purchase:authorize")}
            puedeRecibir={can(user.role, "purchase:receive")}
            puedeColocar={can(user.role, "purchase:request")}
            comprasInternas={user.organization.comprasInternas}
          />
        </div>

        <div className="grid gap-4">
          <Card>
            <p className="text-xs font-semibold text-slate-800">Datos</p>
            <dl className="mt-2 grid gap-1.5 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Solicitó</dt>
                <dd className="text-right text-slate-800">{compra.solicitante?.name ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Pedida</dt>
                <dd className="text-right text-slate-800">{formatDateTime(compra.createdAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Autorizó</dt>
                <dd className="text-right text-slate-800">
                  {quienAutorizo(compra.autorizadaPor?.name, compra.autorizadaEl) ?? "—"}
                  {compra.autorizadaEl ? <span className="block text-[0.625rem] text-slate-400">{formatDateTime(compra.autorizadaEl)}</span> : null}
                </dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Orden de compra</dt>
                <dd className="text-right font-mono text-slate-800">
                  {compra.ordenCompra ?? "—"}
                  {orden ? (
                    <span className="block font-sans text-[0.625rem] font-normal text-slate-400">
                      {orden.supplier.name}
                      {orden.fechaPrometida ? ` · promete ${formatDateTime(orden.fechaPrometida).slice(0, 10)}` : ""}
                    </span>
                  ) : null}
                </dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Proveedor sugerido</dt>
                <dd className="text-right text-slate-800">{compra.proveedorSugerido?.name ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Nace de</dt>
                <dd className="text-right">
                  {compra.materialRequest
                    ? <Link href={`/requisiciones/${compra.materialRequest.id}`} className="text-brand-600 hover:underline">{compra.materialRequest.folio}</Link>
                    : "—"}
                </dd></div>
            </dl>
            {compra.justificacion ? (
              <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">{compra.justificacion}</p>
            ) : null}
          </Card>

          <Card>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-slate-800">Recepciones</p>
              {recibidoReal ? <span className="text-[0.6875rem] text-slate-500">{formatCurrency(recibidoReal, moneda)} recibido</span> : null}
            </div>
            {compra.recepciones.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">Todavía no llega nada.</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {compra.recepciones.map((rec) => (
                  <li key={rec.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                    <p className="text-xs font-medium text-slate-800">
                      {rec.folio}
                      {rec.remision ? <span className="font-normal text-slate-500"> · remisión {rec.remision}</span> : null}
                    </p>
                    <p className="text-[0.625rem] text-slate-500">
                      {formatDateTime(rec.createdAt)}
                      {rec.supplier?.name ? ` · ${rec.supplier.name}` : ""}
                      {rec.recibidoPor?.name ?? rec.recibidoPorNombre ? ` · recibió ${rec.recibidoPor?.name ?? rec.recibidoPorNombre}` : ""}
                    </p>
                    <ul className="mt-1 grid gap-0.5">
                      {rec.renglones.map((l) => (
                        <li key={l.id} className="text-[0.6875rem] text-slate-600">
                          <span className="tabular-nums font-medium">{formatNumber(l.cantidad, 2)}</span> {l.part.unit} · {l.part.code}
                          {!l.conforme ? (
                            <span className="ml-1 rounded bg-amber-100 px-1 text-[0.5625rem] font-medium text-amber-800">
                              no conforme{l.observacion ? `: ${l.observacion}` : ""}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Aquí es donde se dan los acuerdos que no son una orden:
          «cotiza con tres proveedores», «revisa la frecuencia con
          producción». */}
      <div className="mt-4">
        <Compromisos entidad="PurchaseRequest" entidadId={compra.id} yo={user.id} zona={user.organization.timezone} />
      </div>
    </>
  );
}
