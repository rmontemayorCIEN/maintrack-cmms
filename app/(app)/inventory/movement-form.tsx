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

  return (
    <form onSubmit={submit} className="flex items-center gap-1">
      <select value={type} onChange={(e) => setType(e.target.value)} className="field max-w-24 px-1.5 py-1 text-[0.6875rem]">
        <option value="IN">Entrada</option>
        <option value="OUT">Salida</option>
        <option value="ADJUST">Ajuste</option>
      </select>
      <input
        type="number"
        step="0.5"
        className="field max-w-20 px-1.5 py-1 text-[0.6875rem]"
        placeholder={unit}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <button
        type="submit"
        disabled={loading || !quantity}
        className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        title={error ?? "Aplicar"}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "→"}
      </button>
    </form>
  );
}
