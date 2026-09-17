import Link from "next/link";
import { Badge, Card, CardHeader } from "@/components/ui";
import { MAINTENANCE_TYPE_COLORS, MAINTENANCE_TYPE_LABELS } from "@/lib/constants";
import { materialPorActividad } from "@/lib/material-por-actividad";
import { formatCurrency, formatNumber } from "@/lib/utils";

/**
 * Qué material necesitó cada actividad, y en qué va.
 *
 * Es la pregunta que antes no se podía contestar: la orden decía cuánto costó
 * en refacciones, pero no si eso fue del preventivo o de la falla que se
 * atendió en el mismo viaje. Aquí cada actividad muestra lo suyo, con el tipo
 * que ella misma tiene, y el costo neto ya descontando lo devuelto.
 */
export async function MaterialPorActividad({
  organizationId, workOrderId, moneda,
}: {
  organizationId: string; workOrderId: string; moneda: string;
}) {
  const grupos = await materialPorActividad(organizationId, workOrderId);
  if (!grupos.length) return null;

  return (
    <Card>
      <CardHeader
        title="Material por actividad"
        subtitle="Lo que pidió cada actividad, lo que se le entregó, lo que falta y lo que costó ya neto de devoluciones."
      />
      <div className="grid gap-3">
        {grupos.map((g) => (
          <div key={g.taskId ?? "general"} className="rounded-lg border border-slate-200 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-slate-800">{g.titulo}</p>
              {g.tipo ? (
                <Badge className={MAINTENANCE_TYPE_COLORS[g.tipo]}>{MAINTENANCE_TYPE_LABELS[g.tipo]}</Badge>
              ) : (
                <Badge tone="muted">Sin tipo: material de la orden completa</Badge>
              )}
              <span className="ml-auto text-xs font-medium tabular-nums text-slate-700">
                {formatCurrency(g.costoNeto, moneda)}
              </span>
            </div>
            <ul className="mt-1.5 grid gap-1">
              {g.renglones.map((r, i) => (
                <li key={i} className="text-[0.6875rem] text-slate-600">
                  <span className="text-slate-800">{r.descripcion}</span>{" "}
                  · pedido {formatNumber(r.solicitada, 2)} {r.unidad}
                  · entregado {formatNumber(r.surtida, 2)}
                  {r.devuelta ? ` · devuelto ${formatNumber(r.devuelta, 2)}` : ""}
                  {r.pendiente ? <span className="text-amber-700"> · pendiente {formatNumber(r.pendiente, 2)}</span> : ""}
                  {r.comprada ? ` · en compra ${formatNumber(r.comprada, 2)}${r.recibida ? `, recibido ${formatNumber(r.recibida, 2)}` : ""}` : ""}
                  <span className="text-slate-400">
                    {" "}· vale {r.folioVale}{r.foliosCompra.length ? ` · compra ${r.foliosCompra.join(", ")}` : ""}
                  </span>
                </li>
              ))}
              {!g.renglones.length ? (
                <li className="text-[0.6875rem] text-slate-500">
                  Sin requisición: la refacción se cargó directo a la orden.
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.625rem] text-slate-400">
        El material de vales anteriores a este cambio aparece como consumo general: no se le asigna una
        actividad sin evidencia. <Link href="/requisiciones" className="text-brand-600 hover:underline">Ver requisiciones</Link>
      </p>
    </Card>
  );
}
