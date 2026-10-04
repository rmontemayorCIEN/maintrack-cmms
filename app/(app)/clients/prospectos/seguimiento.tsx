"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MOTIVOS_PERDIDA } from "@/lib/prospectos-catalogo";

export function SeguimientoProspecto({ p, estados }: { p: { id: string; estado: string; resultado: string | null; motivoPerdida: string | null; notas: string | null }; estados: Array<{ clave: string; nombre: string }> }) {
  const router = useRouter();
  const [v, setV] = useState({ estado: p.estado, motivoPerdida: p.motivoPerdida ?? "", notas: p.notas ?? "", resultado: p.resultado ?? "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setGuardando(true); setError(null);
    const r = await fetch(`/api/admin/prospectos/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...v, motivoPerdida: v.motivoPerdida || null }) }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setGuardando(false);
    if (!r?.ok) { setError(d?.error ?? "No se pudo guardar"); return; }
    router.refresh();
  };
  return (
    <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
      <div><label className="label" htmlFor={`e-${p.id}`}>Estado</label><select id={`e-${p.id}`} className="field" value={v.estado} onChange={(e) => setV({ ...v, estado: e.target.value })}>{estados.map((e) => <option key={e.clave} value={e.clave}>{e.nombre}</option>)}</select></div>
      <div className="grid gap-2 sm:grid-cols-2">
        {v.estado === "PERDIDA" ? <div><label className="label" htmlFor={`m-${p.id}`}>Motivo</label><select id={`m-${p.id}`} className="field" value={v.motivoPerdida} onChange={(e) => setV({ ...v, motivoPerdida: e.target.value })}><option value="">Elija</option>{MOTIVOS_PERDIDA.map((m) => <option key={m}>{m}</option>)}</select></div> : <div><label className="label" htmlFor={`r-${p.id}`}>Resultado</label><input id={`r-${p.id}`} className="field" value={v.resultado} onChange={(e) => setV({ ...v, resultado: e.target.value })} maxLength={500} /></div>}
        <div><label className="label" htmlFor={`n-${p.id}`}>Notas</label><input id={`n-${p.id}`} className="field" value={v.notas} onChange={(e) => setV({ ...v, notas: e.target.value })} maxLength={2000} /></div>
      </div>
      <button type="button" onClick={guardar} disabled={guardando} className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-60">Guardar</button>
      {error ? <p role="alert" className="text-sm text-red-700 sm:col-span-3">{error}</p> : null}
    </div>
  );
}
