"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Entrada, salida o ajuste rapido desde la tabla del almacen. */
export function MovementForm({ partId, unit, warehouseId }: { partId: string; unit: string; warehouseId?: string | null }) {
  const router = useRouter();
  const [type, setType] = useState("IN");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!quantity) return;
    setLoading(true);
    setError(null);
    const res = await fetch("/api/parts/movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId, warehouseId: warehouseId ?? null, movementType: type, quantity: Number(quantity), reference: "Ajuste manual" }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Error");
      return;
    }
    setQuantity("");
    router.refresh();
  }

  /*
   * Se captura de pie junto al anaquel, con el telefono en una mano.
   *
   * `shrink-0` NO es adorno. `.field` trae `width: 100%`, y en un contenedor
   * que se ajusta al contenido —una celda de tabla— flex encoge los controles
   * hasta el ancho minimo: quedaban en 24 px, un campo donde no cabe ni un
   * numero de dos digitos. Con shrink-0 conservan el ancho declarado.
   *
   * No se pone `text-xs`: `.field` ya fija 0.875rem y le gana por orden. La
   * clase quedaria ahi aparentando hacer algo.
   *
   * Estaba en 80 px de ancho y letra de 11 px: en un pulgar no se atina ni se
   * lee lo que uno acaba de escribir. Los tres controles crecen y el boton
   * pasa a 36 px, que es el minimo con el que una persona no falla el toque.
   * La tabla ya se desliza de lado, asi que el ancho extra no rompe nada.
   */
  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="field w-28 shrink-0 max-w-28 px-2 py-1.5"
      >
        <option value="IN">Entrada</option>
        <option value="OUT">Salida</option>
        <option value="ADJUST">Ajuste</option>
      </select>
      <input
        type="number"
        step="0.5"
        min="0"
        /* Abre el teclado numerico del telefono, con punto decimal. Sin esto
           el usuario recibe el teclado completo y tiene que cambiarlo a mano. */
        inputMode="decimal"
        className="field w-24 shrink-0 max-w-24 px-2 py-1.5"
        placeholder={unit}
        aria-label={`Cantidad en ${unit}`}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <button
        type="submit"
        disabled={loading || !quantity}
        aria-label="Aplicar movimiento"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        title={error ?? "Aplicar"}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "→"}
      </button>
    </form>
  );
}
