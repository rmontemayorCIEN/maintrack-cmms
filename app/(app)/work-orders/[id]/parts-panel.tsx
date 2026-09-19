"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { pedir } from "@/lib/cliente/pedir";
import { SelectActividad, type ActividadCargable } from "@/components/select-actividad";

export function PartsPanel({
  actividades,
  workOrderId,
  used,
  catalog,
  currency,
  editable,
}: {
  workOrderId: string;
  /** Las actividades de la orden, para cargarle el gasto a una. */
  actividades: ActividadCargable[];
  used: Array<{ id: string; code: string; name: string; unit: string; quantity: number; cost: number }>;
  catalog: Array<{ id: string; code: string; name: string; unit: string; unitCost: number; quantityOnHand: number }>;
  /** Vacía para quien no ve costos (lib/pantallas.ts verCostos): no se pintan importes. */
  currency: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [partId, setPartId] = useState(catalog[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [taskId, setTaskId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (loading) return; // un doble toque no saca dos veces del almacén
    setLoading(true);
    setError(null);
    const r = await pedir(`/api/work-orders/${workOrderId}/parts`, {
      method: "POST",
      json: { partId, quantity: Number(quantity), taskId: taskId || null },
    });
    setLoading(false);
    if (!r.ok) { setError(r.error); return; }
    setQuantity("1");
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {used.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">
          Sin refacciones cargadas
        </p>
      ) : (
        <ul className="grid gap-2">
          {used.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-700">{item.name}</p>
                <p className="text-[0.6875rem] text-slate-400">{item.code}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium tabular-nums text-slate-700">
                  {formatNumber(item.quantity, 2)} {item.unit}
                </p>
                {currency ? <p className="text-[0.6875rem] tabular-nums text-slate-400">{formatCurrency(item.cost, currency)}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        catalog.length === 0 ? (
          <p className="text-[0.6875rem] text-slate-400">No hay refacciones con existencia en el almacén.</p>
        ) : (
          <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
            <select className="field" aria-label="Refacción" value={partId} onChange={(e) => setPartId(e.target.value)}>
              {catalog.map((part) => (
                <option key={part.id} value={part.id}>
                  {part.code} — {part.name} ({formatNumber(part.quantityOnHand, 0)} {part.unit})
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="number" inputMode="decimal"
                step="0.5"
                min="0.5"
                className="field max-w-24"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                aria-label="Cantidad"
              />
              <Button size="sm" onClick={add} disabled={loading} className="flex-1">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Cargar a la OT
              </Button>
            </div>
            <SelectActividad actividades={actividades} valor={taskId} onChange={setTaskId} />
          {error ? <p className="text-[0.6875rem] text-red-600">{error}</p> : null}
          </div>
        )
      ) : null}
    </div>
  );
}
