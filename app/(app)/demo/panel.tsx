"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { EVENTO_REINICIAR } from "@/components/demo/recorrido";

export function ReiniciarRecorrido() {
  const [hecho, setHecho] = useState(false);
  return (
    <button type="button" onClick={() => { window.dispatchEvent(new Event(EVENTO_REINICIAR)); setHecho(true); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 text-sm font-medium text-violet-900 hover:bg-violet-100">
      <RotateCcw className="h-4 w-4" /> {hecho ? "Recorrido reiniciado" : "Reiniciar el recorrido guiado"}
    </button>
  );
}

type Previa = { hoy: Record<string, number>; seConserva: string[]; seRestaura: string[] };

const NOMBRES: Record<string, string> = { activos: "activos", planes: "planes", ordenes: "órdenes", abiertas: "abiertas", solicitudes: "solicitudes", refacciones: "refacciones", compras: "compras", lecturas: "lecturas", alertas: "alertas abiertas", usuarios: "usuarios" };

/** Qué se conserva, qué se restaura, confirmación escrita y resultado. */
export function PanelRestaurar({ previa }: { previa: Previa }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<"listo" | "restaurando" | "hecho">("listo");
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<Record<string, number> | null>(null);

  async function restaurar() {
    if (estado === "restaurando") return;
    setEstado("restaurando"); setError(null);
    try {
      const r = await fetch("/api/demo/restaurar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmacion: texto.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo restaurar."); setEstado("listo"); return; }
      setResumen(d.resumen); setEstado("hecho"); setTexto("");
      router.refresh();
    } catch {
      setError("No hay conexión. No se restauró nada."); setEstado("listo");
    }
  }

  return (
    <div className="mt-3 grid gap-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><p className="font-medium text-slate-900">Se conserva</p><ul className="mt-1 list-disc pl-5 text-slate-700">{previa.seConserva.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <div><p className="font-medium text-slate-900">Se restaura (lo capturado se pierde)</p><ul className="mt-1 list-disc pl-5 text-slate-700">{previa.seRestaura.map((x) => <li key={x}>{x}</li>)}</ul></div>
      </div>
      <p className="text-xs text-slate-500">Hoy tiene: {Object.entries(previa.hoy).map(([k, v]) => `${v} ${NOMBRES[k] ?? k}`).join(" · ")}</p>
      {estado === "hecho" && resumen ? (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">Listo: la demo quedó en su estado inicial ({resumen.activos} activos, {resumen.ordenes} órdenes, {resumen.abiertas} abiertas). La operación quedó registrada en la auditoría.</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="confirmar-restaurar" className="label">Escriba RESTAURAR para confirmar</label>
          <input id="confirmar-restaurar" className="field" value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" autoCapitalize="characters" />
        </div>
        <button type="button" onClick={restaurar} disabled={texto.trim() !== "RESTAURAR" || estado === "restaurando"} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          {estado === "restaurando" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          {estado === "restaurando" ? "Restaurando…" : "Restaurar la demo"}
        </button>
      </div>
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
    </div>
  );
}
