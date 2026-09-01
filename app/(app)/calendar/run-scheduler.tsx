"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarSync, Check, Loader2, X } from "lucide-react";
import { Button, Card } from "@/components/ui";

type Detalle = { plan: string; workOrder?: string; reason?: string };
type Resultado = { generated: number; skipped: number; details: Detalle[] };

/**
 * Dispara el motor de programacion.
 *
 * Muestra POR QUE se omitio cada plan. El motor siempre calculo ese motivo y
 * la pantalla lo tiraba: el usuario veia "0 generadas" y no tenia forma de
 * saber si el plan estaba mal configurado o simplemente todavia no tocaba.
 *
 * El horizonte permite adelantarse: por omision genera lo que ya dispara hoy,
 * pero antes de un puente o un fin de semana conviene sacar lo de la semana.
 */
const HORIZONTES = [
  { dias: 0, etiqueta: "Lo que toca hoy" },
  { dias: 7, etiqueta: "Próximos 7 días" },
  { dias: 30, etiqueta: "Próximos 30 días" },
];

export function RunSchedulerButton({ horizonDays = 0 }: { horizonDays?: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [horizonte, setHorizonte] = useState(horizonDays);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null); setResultado(null);
    const res = await fetch("/api/scheduler", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horizonDays: horizonte }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Error al ejecutar el programador"); return; }
    setResultado(data as Resultado);
    router.refresh();
  }

  const generadas = resultado?.details.filter((d) => d.workOrder) ?? [];
  const omitidas = resultado?.details.filter((d) => !d.workOrder) ?? [];

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={horizonte}
          onChange={(e) => { setHorizonte(Number(e.target.value)); setResultado(null); }}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
        >
          {HORIZONTES.map((h) => <option key={h.dias} value={h.dias}>{h.etiqueta}</option>)}
        </select>
        <Button size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarSync className="h-3.5 w-3.5" />}
          Ejecutar programador
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}

      {resultado ? (
        <Card>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold text-slate-800">
              {resultado.generated
                ? `${resultado.generated} orden(es) generada(s)`
                : "No había nada que generar"}
            </p>
            <button
              type="button" onClick={() => setResultado(null)}
              className="rounded p-0.5 text-slate-400 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {generadas.length ? (
            <ul className="mt-2 grid gap-1">
              {generadas.map((d, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                  <span><span className="font-medium">{d.workOrder}</span> · {d.plan}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {omitidas.length ? (
            <>
              <p className="mt-3 text-[0.6875rem] font-medium uppercase tracking-wide text-slate-500">
                {omitidas.length} plan(es) sin generar, y por qué
              </p>
              <ul className="mt-1 grid gap-1">
                {omitidas.map((d, i) => (
                  <li key={i} className="text-xs text-slate-600">
                    <span className="font-medium text-slate-800">{d.plan}</span>
                    <span className="text-slate-500"> — {d.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.625rem] text-slate-400">
                «Fuera de ventana» significa que el plan todavía no toca. Amplíe el horizonte
                arriba si quiere adelantar la generación.
              </p>
            </>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
