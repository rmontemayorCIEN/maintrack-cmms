"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { SelectorBuscable } from "@/components/selector-buscable";
import { SelectActividad, type ActividadCargable } from "@/components/select-actividad";

type Linea = {
  id: string;
  descripcion: string;
  proveedor: string | null;
  quantity: number;
  unitCost: number;
  cost: number;
  folioProveedor: string | null;
  nota: string | null;
};

/**
 * Servicios que se contrataron afuera para completar la orden.
 *
 * El catalogo solo prellena: el costo real es el que cobra el proveedor esa
 * vez, asi que siempre queda editable antes de cargarlo.
 */
export function ServicesPanel({
  workOrderId,
  actividades,
  lineas,
  catalogo,
  proveedores,
  currency,
  editable,
}: {
  workOrderId: string;
  /** Las actividades de la orden, para cargarle el gasto a una. */
  actividades: ActividadCargable[];
  lineas: Linea[];
  catalogo: Array<{ id: string; code: string; name: string; unit: string; unitCost: number; supplierId: string | null }>;
  proveedores: Array<{ id: string; name: string }>;
  currency: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("0");
  const [folio, setFolio] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function elegirServicio(id: string) {
    setServiceId(id);
    const srv = catalogo.find((c) => c.id === id);
    if (srv) {
      setUnitCost(String(srv.unitCost));
      if (srv.supplierId) setSupplierId(srv.supplierId);
    }
  }

  async function add() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/work-orders/${workOrderId}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: serviceId || null,
        supplierId: supplierId || null,
        descripcion: descripcion || null,
        quantity: Number(quantity),
        unitCost: Number(unitCost),
        folioProveedor: folio || null,
        taskId: taskId || null,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "No fue posible cargar el servicio");
      return;
    }
    setServiceId(""); setDescripcion(""); setQuantity("1"); setUnitCost("0"); setFolio("");
    router.refresh();
  }

  async function quitar(lineaId: string) {
    if (!confirm("¿Quitar este servicio de la orden?")) return;
    setLoading(true);
    await fetch(`/api/work-orders/${workOrderId}/services?linea=${lineaId}`, { method: "DELETE" });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {lineas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">
          Sin servicios subcontratados
        </p>
      ) : (
        <ul className="grid gap-2">
          {lineas.map((linea) => (
            <li key={linea.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-700">{linea.descripcion}</p>
                <p className="text-[0.6875rem] text-slate-400">
                  {linea.proveedor ?? "Sin proveedor"}
                  {linea.folioProveedor ? ` · folio ${linea.folioProveedor}` : ""}
                </p>
              </div>
              <div className="flex items-start gap-1">
                <div className="text-right">
                  <p className="text-xs font-medium tabular-nums text-slate-700">
                    {formatNumber(linea.quantity, 2)} × {formatCurrency(linea.unitCost, currency)}
                  </p>
                  <p className="text-[0.6875rem] tabular-nums text-slate-400">{formatCurrency(linea.cost, currency)}</p>
                </div>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => quitar(linea.id)}
                    title="Quitar"
                    className="grid h-6 w-6 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-600"
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
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
          <SelectorBuscable
            valor={serviceId}
            onCambio={elegirServicio}
            vacio="Servicio no catalogado…"
            marcador="Busque por clave o nombre del servicio"
            opciones={catalogo.map((srv) => ({
              id: srv.id,
              etiqueta: `${srv.code} — ${srv.name}`,
              detalle: `${formatCurrency(srv.unitCost, currency)}/${srv.unit}`,
            }))}
          />
          {!serviceId ? (
            <input
              className="field"
              placeholder="Que se contrato"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          ) : null}
          <SelectorBuscable
            valor={supplierId}
            onCambio={setSupplierId}
            vacio="Sin proveedor"
            marcador="Busque por nombre del proveedor"
            opciones={proveedores.map((p) => ({ id: p.id, etiqueta: p.name }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Cantidad</label>
              <input type="number" step="0.5" min="0.5" className="field" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <label className="label">Costo unitario</label>
              <input type="number" step="0.01" min="0" className="field" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </div>
          </div>
          <input
            className="field"
            placeholder="Folio o factura del proveedor (opcional)"
            value={folio}
            onChange={(e) => setFolio(e.target.value)}
          />
          <Button
            size="sm"
            onClick={add}
            disabled={loading || (!serviceId && descripcion.trim().length < 3)}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Cargar {formatCurrency(Number(quantity || 0) * Number(unitCost || 0), currency)} a la OT
          </Button>
          <SelectActividad actividades={actividades} valor={taskId} onChange={setTaskId} />
          {error ? <p className="text-[0.6875rem] text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
