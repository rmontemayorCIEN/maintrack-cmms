"use client";

import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";

type Propuesta = {
  familia: string; orden: number; porQue: string;
  comoPartirlos: string; planesQueFaltan: number; frecuenciaSugerida: string;
  actividadesTipicas: string[];
};

/**
 * Por donde empezar cuando no hay ningun plan.
 *
 * No crea nada: propone el orden y el contenido tipico de cada familia. Armar
 * el plan sigue siendo del usuario —el generador de planes lo redacta despues
 * para un equipo concreto.
 */
export function ArranqueConIa({ sinPlan }: { sinPlan: number }) {
  const [cargando, setCargando] = useState(false);
  const [r, setR] = useState<{ diagnostico: string; propuestas: Propuesta[]; noTodavia: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pedir() {
    setCargando(true); setError(null); setR(null);
    const res = await fetch("/api/ia/arranque-planes", { method: "POST" });
    const c = await res.json().catch(() => null);
    setCargando(false);
    if (!res.ok) { setError(c?.error ?? "No fue posible analizar."); return; }
    setR(c.propuesta);
  }

  if (sinPlan === 0) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <p className="text-sm font-semibold text-slate-800">¿Por dónde empezar?</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Con {sinPlan} equipos sin plan, la hoja en blanco es el problema. La IA lee su catálogo
            —incluyendo qué familias generan más correctivo— y propone el orden de arranque.
            <b> No crea nada</b>: usted decide.
          </p>
        </div>
        <Button onClick={pedir} disabled={cargando}>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {cargando ? "Analizando…" : "Proponer un orden"}
        </Button>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}

      {r ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-slate-700">{r.diagnostico}</p>
            <button type="button" onClick={() => setR(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>

          <ol className="mt-3 grid gap-2">
            {r.propuestas.map((p) => (
              <li key={p.familia} className="rounded-lg border border-slate-200 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-800 text-[0.6875rem] font-medium text-white">
                    {p.orden}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{p.familia}</span>
                  <Badge tone="info">{p.frecuenciaSugerida}</Badge>
                  {p.planesQueFaltan > 0 ? (
                    <Badge tone="warning">
                      {p.planesQueFaltan === 1 ? "falta 1 plan" : `faltan ${p.planesQueFaltan} planes`}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-600">{p.porQue}</p>
                <p className="mt-1 text-xs text-amber-800">{p.comoPartirlos}</p>
                {p.actividadesTipicas.length ? (
                  <ul className="mt-1.5 grid gap-0.5">
                    {p.actividadesTipicas.map((a, i) => (
                      <li key={i} className="text-xs text-slate-500">· {a}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>

          {r.noTodavia ? (
            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <b>Para después: </b>{r.noTodavia}
            </p>
          ) : null}

          <p className="mt-3 text-xs text-slate-400">
            Esto es el orden, no el plan. Para cada familia, cree el plan desde un equipo representativo
            —el generador de planes lo redacta completo— y aplíquelo a los demás desde esta pantalla.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
