"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { pedir } from "@/lib/cliente/pedir";
import { SelectActividad, type ActividadCargable } from "@/components/select-actividad";
import { SelectorBuscable } from "@/components/selector-buscable";

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
  /*
   * Arranca VACIO. Antes venia preseleccionada la primera del catalogo, asi
   * que un toque en «Cargar a la OT» sacaba del almacen la que estuviera
   * hasta arriba —y eso mueve inventario y escribe kardex—. Ahora hay que
   * elegir a proposito.
   */
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [taskId, setTaskId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (loading) return; // un doble toque no saca dos veces del almacén
    if (!partId) { setError("Elija la refacción que se cargó."); return; }
    setLoading(true);
    setError(null);
    const r = await pedir(`/api/work-orders/${workOrderId}/parts`, {
      method: "POST",
      json: { partId, quantity: Number(quantity), taskId: taskId || null },
    });
    setLoading(false);
    if (!r.ok) { setError(r.error); return; }
    setQuantity("1");
    setPartId("");
    router.refresh();
  }

  /**
   * Quitar una refaccion NO es borrar un renglon: la cantidad regresa al
   * almacen con una devolucion, y por eso se dice en la pregunta. Quien la
   * quita tiene que saber que la pieza vuelve a estar disponible.
   */
  async function quitar(lineaId: string, nombre: string, cantidad: number, unidad: string) {
    if (loading) return;
    if (!confirm(`¿Quitar ${formatNumber(cantidad, 2)} ${unidad} de ${nombre} de esta orden?\n\nSe devuelve al almacén y el costo de la orden se recalcula.`)) return;
    setLoading(true);
    setError(null);
    const r = await pedir(`/api/work-orders/${workOrderId}/parts?linea=${lineaId}`, { method: "DELETE" });
    setLoading(false);
    if (!r.ok) { setError(r.error); return; }
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
              <div className="flex items-center gap-1">
                <div className="text-right">
                  <p className="text-xs font-medium tabular-nums text-slate-700">
                    {formatNumber(item.quantity, 2)} {item.unit}
                  </p>
                  {currency ? <p className="text-[0.6875rem] tabular-nums text-slate-400">{formatCurrency(item.cost, currency)}</p> : null}
                </div>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => quitar(item.id, item.name, item.quantity, item.unit)}
                    disabled={loading}
                    title="Quitar y devolver al almacén"
                    className="grid h-6 w-6 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
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
            {/*
              Buscador y no un desplegable: el almacen de una planta tiene
              cientos de refacciones y el tecnico esta buscando UNA, en el
              piso y con el telefono. Recorrer la lista no es una opcion. Se
              busca por clave o por cualquier palabra del nombre, sin acentos
              —«refrigerante» encuentra «Refrigerante glicol»— igual que en
              compras y en el calendario.
            */}
            <SelectorBuscable
              valor={partId}
              onCambio={setPartId}
              vacio="Elija una refacción"
              marcador="Busque por clave o nombre"
              opciones={catalog.map((part) => ({
                id: part.id,
                etiqueta: `${part.code} — ${part.name} (${formatNumber(part.quantityOnHand, 0)} ${part.unit})`,
              }))}
            />
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
              <Button size="sm" onClick={add} disabled={loading || !partId} className="flex-1">
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
