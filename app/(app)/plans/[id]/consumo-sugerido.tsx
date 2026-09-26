"use client";

import { useState } from "react";
import { Check, Loader2, PackagePlus, Sparkles, X } from "lucide-react";
import { formatNumber } from "@/lib/utils";

/**
 * Qué consume cada actividad, propuesto y revisado.
 *
 * ── Por qué se acepta una por una ──
 *
 * Este dato se convierte después en compras: la proyección lo usa para decir
 * qué pedir y cuánto. Un «aceptar todo» sin leer mete material que nadie
 * verificó en la lista de compras del trimestre, y el error se descubre
 * cuando llega la factura. Cada renglón se marca a mano, y nada se guarda
 * hasta que alguien le da guardar.
 *
 * ── Las tres respuestas ──
 *
 * Se enseñan las tres, no solo las propuestas: las actividades que NO
 * consumen material son una respuesta válida —y la más común— y saberlo es lo
 * que permite dejar de buscarles refacción. Las que consumen algo que no está
 * en el catálogo son la tercera, y ésas son tarea de almacén, no del plan.
 */

type Linea = {
  taskId: string;
  titulo: string;
  refacciones: Array<{ partId: string; code: string; name: string; unit: string; cantidad: number; porQue: string }>;
};
type Propuesta = {
  lineas: Linea[];
  sinConsumo: Array<{ numero: number; id: string; titulo: string }>;
  sinCatalogo: Array<{ taskId: string; titulo: string; queFalta: string }>;
  inventadas: string[];
};

export function ConsumoSugerido({ planId, disponible }: { planId: string; disponible: boolean }) {
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [p, setP] = useState<Propuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  // Clave «tarea|refacción»: se acepta renglón por renglón.
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());

  if (!disponible) return null;
  const clave = (t: string, r: string) => `${t}|${r}`;

  async function proponer() {
    setCargando(true); setError(null); setListo(null); setP(null);
    try {
      const res = await fetch("/api/ia/recursos-plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo revisar el plan."); return; }
      setP(d);
      // Todo marcado de entrada, pero visible: lo que se quita es más rápido
      // de ver que lo que falta por marcar.
      setElegidas(new Set((d.lineas as Linea[]).flatMap((l) => l.refacciones.map((r) => clave(l.taskId, r.partId)))));
    } catch {
      setError("Se perdió la conexión.");
    } finally { setCargando(false); }
  }

  async function guardar() {
    if (!p || guardando) return;
    const lineas = p.lineas
      .map((l) => ({
        taskId: l.taskId,
        refacciones: l.refacciones.filter((r) => elegidas.has(clave(l.taskId, r.partId))).map((r) => ({ partId: r.partId, cantidad: r.cantidad })),
      }))
      .filter((l) => l.refacciones.length);
    if (!lineas.length) { setError("No hay nada marcado para guardar."); return; }
    setGuardando(true); setError(null);
    try {
      const res = await fetch("/api/ia/recursos-plan", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, lineas }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo guardar."); return; }
      setListo(`Se cargó el consumo de ${d.actividades} actividad(es): ${d.refacciones} refacción(es).`);
      setP(null);
      // La pantalla la pinta el servidor: al recargar se ve lo guardado.
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setError("Se perdió la conexión.");
    } finally { setGuardando(false); }
  }

  const marcadas = p ? p.lineas.flatMap((l) => l.refacciones.filter((r) => elegidas.has(clave(l.taskId, r.partId)))).length : 0;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {!p ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button" onClick={() => void proponer()} disabled={cargando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            {cargando ? "Revisando el plan…" : "Sugerir qué consume cada actividad"}
          </button>
          <span className="text-[0.625rem] text-slate-500">
            Propone del catálogo de su empresa. Nada se guarda sin que usted lo marque.
          </span>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      {listo ? <p className="mt-2 text-xs font-medium text-emerald-700">{listo}</p> : null}

      {p ? (
        <div className="grid gap-3">
          {p.lineas.length ? (
            <ul className="grid gap-2">
              {p.lineas.map((l) => (
                <li key={l.taskId} className="rounded-lg border border-slate-200 p-2.5">
                  <p className="text-xs font-medium text-slate-800">{l.titulo}</p>
                  <ul className="mt-1.5 grid gap-1">
                    {l.refacciones.map((r) => {
                      const k = clave(l.taskId, r.partId);
                      const on = elegidas.has(k);
                      return (
                        <li key={k}>
                          <label className="flex cursor-pointer items-start gap-2 text-xs">
                            <input
                              type="checkbox" checked={on}
                              onChange={() => setElegidas((s) => {
                                const n = new Set(s);
                                if (n.has(k)) n.delete(k); else n.add(k);
                                return n;
                              })}
                              className="mt-0.5 h-3.5 w-3.5"
                            />
                            <span className={on ? "text-slate-800" : "text-slate-400"}>
                              <span className="font-medium tabular-nums">{formatNumber(r.cantidad, 2)} {r.unit}</span> de {r.code} · {r.name}
                              {r.porQue ? <span className="block text-[0.625rem] text-slate-500">{r.porQue}</span> : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No propuso material para ninguna actividad.</p>
          )}

          {p.sinConsumo.length ? (
            <p className="text-[0.6875rem] text-slate-500">
              <Check className="mr-1 inline h-3.5 w-3.5 text-emerald-600" aria-hidden />
              <span className="font-medium">{p.sinConsumo.length} actividad(es) no gastan material</span> —revisar, medir,
              limpiar o probar—: {p.sinConsumo.map((s) => s.titulo).join("; ")}. Es una respuesta correcta, no un hueco.
            </p>
          ) : null}

          {p.sinCatalogo.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[0.6875rem] text-amber-900">
              <p className="font-medium">
                <PackagePlus className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                {p.sinCatalogo.length} actividad(es) consumen algo que no está en su catálogo:
              </p>
              <ul className="mt-0.5 grid gap-0.5 pl-5">
                {p.sinCatalogo.map((x) => <li key={x.taskId} className="list-disc">{x.titulo}: {x.queFalta}</li>)}
              </ul>
              <p className="mt-1">Déelas de alta en Almacén y vuelva a pedir la sugerencia.</p>
            </div>
          ) : null}

          {p.inventadas.length ? (
            <p className="text-[0.625rem] text-slate-400">
              Se descartaron {p.inventadas.length} código(s) que no existen en su catálogo: {p.inventadas.join(", ")}.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button" onClick={() => void guardar()} disabled={guardando || !marcadas}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              Guardar {marcadas} marcada(s)
            </button>
            <button
              type="button" onClick={() => { setP(null); setError(null); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Descartar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
