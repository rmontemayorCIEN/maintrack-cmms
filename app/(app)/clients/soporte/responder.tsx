"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ResponderSoporte({ id, estado, respuesta, estados }: { id: string; estado: string; respuesta: string; estados: Array<{ clave: string; nombre: string }> }) {
  const router = useRouter();
  const [v, setV] = useState({ estado: estado === "RECIBIDA" ? "EN_REVISION" : estado, respuesta });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setGuardando(true); setError(null);
    const r = await fetch(`/api/admin/soporte/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    setGuardando(false);
    if (!r?.ok) { setError(d?.error ?? "No se pudo guardar"); return; }
    router.refresh();
  };
  return (
    <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
      <div><label className="label" htmlFor={`se-${id}`}>Estado</label><select id={`se-${id}`} className="field" value={v.estado} onChange={(e) => setV({ ...v, estado: e.target.value })}>{estados.map((e) => <option key={e.clave} value={e.clave}>{e.nombre}</option>)}</select></div>
      <div><label className="label" htmlFor={`sr-${id}`}>Respuesta para el cliente</label><textarea id={`sr-${id}`} className="field min-h-11" value={v.respuesta} onChange={(e) => setV({ ...v, respuesta: e.target.value })} maxLength={4000} /></div>
      <button type="button" onClick={guardar} disabled={guardando} className="min-h-11 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-60">Guardar y avisar</button>
      {error ? <p role="alert" className="text-sm text-red-700 sm:col-span-3">{error}</p> : null}
    </div>
  );
}
