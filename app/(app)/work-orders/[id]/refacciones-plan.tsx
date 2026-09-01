"use client";

import Link from "next/link";
import { ClipboardList, PackageCheck } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import {
  RequisicionDialog,
  type Existencias,
  type OpcionOrden,
  type RefaccionOpcion,
} from "../../requisiciones/requisicion-dialog";

export type RenglonPlan = {
  partId: string; code: string; name: string; unidad: string;
  actividades: string[];
  pide: number; yaPedido: number; yaConsumido: number; falta: number;
};

/**
 * Las refacciones que el plan pide para esta orden.
 *
 * Una orden preventiva ya sabe que va a consumir: quedo escrito cuando se
 * diseño la rutina. Volver a capturarlo seria pedir dos veces el mismo dato,
 * asi que la requisicion se arma sola y al usuario solo le queda revisar,
 * ajustar y enviar.
 */
export function RefaccionesDelPlan({
  plan, renglones, orden, almacenes, refacciones, existencias, requisiciones, puedePedir,
}: {
  plan: string;
  renglones: RenglonPlan[];
  orden: OpcionOrden;
  almacenes: { id: string; etiqueta: string }[];
  refacciones: RefaccionOpcion[];
  existencias: Existencias;
  requisiciones: Array<{ id: string; folio: string; estado: string; porSurtir: number }>;
  puedePedir: boolean;
}) {
  const pendientes = renglones.filter((r) => r.falta > 0.0001);
  const almacen = almacenes[0]?.id ?? "";
  const hay = (partId: string) => existencias[almacen]?.[partId] ?? 0;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">Refacciones que pide el plan</p>
          <p className="mt-0.5 text-xs text-slate-500">{plan}</p>
        </div>
        {puedePedir && almacenes.length ? (
          <div className="flex flex-wrap gap-1.5">
            {pendientes.length ? (
              <RequisicionDialog
                almacenes={almacenes}
                ordenes={[orden]}
                activos={[]}
                refacciones={refacciones}
                existencias={existencias}
                ordenFija={orden}
                precargados={pendientes.map((r) => ({ partId: r.partId, cantidad: r.falta }))}
                etiqueta="Generar requisición"
              />
            ) : null}
            <RequisicionDialog
              almacenes={almacenes}
              ordenes={[orden]}
              activos={[]}
              refacciones={refacciones}
              existencias={existencias}
              ordenFija={orden}
              etiqueta="Pedir otra cosa"
            />
          </div>
        ) : null}
      </div>

      {renglones.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">El plan no tiene refacciones definidas en sus actividades.</p>
      ) : (
        <div className="table-wrap mt-3">
          <table className="data">
            <thead>
              <tr>
                <th>Refacción</th>
                <th className="text-right">Pide el plan</th>
                <th className="text-right">Ya pedido</th>
                <th className="text-right">Consumido</th>
                <th className="text-right">Falta pedir</th>
                <th className="text-right">En almacén</th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((r) => {
                const disponible = hay(r.partId);
                return (
                  <tr key={r.partId}>
                    <td>
                      <p className="font-medium text-slate-800">{r.code}</p>
                      <p className="text-xs text-slate-500">{r.name}</p>
                      <p className="text-[0.625rem] text-slate-400">{r.actividades.join(" · ")}</p>
                    </td>
                    <td className="text-right tabular-nums text-xs text-slate-700">{formatNumber(r.pide, 2)}</td>
                    <td className="text-right tabular-nums text-xs text-slate-600">
                      {r.yaPedido ? formatNumber(r.yaPedido, 2) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="text-right tabular-nums text-xs text-slate-600">
                      {r.yaConsumido ? formatNumber(r.yaConsumido, 2) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="text-right tabular-nums text-xs">
                      {r.falta > 0.0001
                        ? <span className="font-medium text-amber-700">{formatNumber(r.falta, 2)}</span>
                        : <Badge tone="success">cubierto</Badge>}
                    </td>
                    <td className="text-right tabular-nums text-xs">
                      {r.falta > 0.0001 && disponible < r.falta
                        ? <span className={disponible > 0 ? "text-amber-700" : "text-rose-700"}>{formatNumber(disponible, 2)}</span>
                        : <span className="text-slate-500">{formatNumber(disponible, 2)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {requisiciones.length ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-500">
            Requisiciones de esta orden
          </p>
          <ul className="mt-1.5 grid gap-1">
            {requisiciones.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                <Link href={`/requisiciones/${r.id}`} className="font-medium text-brand-600 hover:underline">
                  {r.folio}
                </Link>
                <span className="text-slate-500">
                  {r.porSurtir > 0.0001 ? (
                    <span className="text-amber-700">{formatNumber(r.porSurtir, 2)} por surtir</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <PackageCheck className="h-3 w-3" /> surtida
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : pendientes.length && puedePedir ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[0.6875rem] leading-relaxed text-slate-600">
          <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>
            La requisición se arma sola con lo que falta. Puede ajustar cantidades o agregar
            renglones antes de enviarla — y si al trabajar aparecen más refacciones, use
            «Pedir otra cosa».
          </span>
        </p>
      ) : null}
    </Card>
  );
}
