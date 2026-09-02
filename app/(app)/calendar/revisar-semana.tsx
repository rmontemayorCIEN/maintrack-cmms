"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Sparkles, Layers, ShieldAlert, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";

type Revision = {
  resumen: string;
  movimientos: { orden: string; aFecha: string; aResponsable: string | null; porQue: string }[];
  agrupaciones: { activo: string; ordenes: string[]; porQue: string }[];
  noMover: { orden: string; porQue: string }[];
  advertencia: string | null;
};

/**
 * Revisa la semana con IA.
 *
 * Los numeros los calcula el sistema; el modelo aporta el criterio: que puede
 * esperar, que conviene juntar en una sola visita y que no se toca aunque el
 * dia venga cargado. Las fechas que propone se verifican contra los dias
 * laborables antes de mostrarse.
 */
export function RevisarSemana({ semana }: { semana: string }) {
  const [cargando, setCargando] = useState(false);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revisar() {
    setCargando(true); setError(null); setRevision(null);
    const res = await fetch("/api/ia/agenda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desde: semana }),
    });
    setCargando(false);
    const cuerpo = await res.json().catch(() => null);
    if (!res.ok) {
      setError(cuerpo?.error ?? "No fue posible revisar la semana.");
      return;
    }
    setRevision(cuerpo.revision);
  }

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short" })
      .format(new Date(`${iso}T12:00:00`));

  return (
    <>
      <Button variant="ghost" onClick={revisar} disabled={cargando}>
        {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {cargando ? "Revisando…" : "Revisar la semana"}
      </Button>

      {error ? (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </p>
      ) : null}

      {revision ? (
        <Card className="mt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <p className="text-sm text-slate-700">{revision.resumen}</p>
            </div>
            <button
              type="button"
              onClick={() => setRevision(null)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {revision.movimientos.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Conviene mover
              </p>
              <ul className="mt-2 grid gap-1.5">
                {revision.movimientos.map((m, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Link href={`/work-orders?q=${m.orden}`} className="font-medium text-brand-600 hover:underline">
                        {m.orden}
                      </Link>
                      <ArrowRight className="h-3 w-3 text-slate-400" />
                      <span className="font-medium capitalize text-slate-700">{fmt(m.aFecha)}</span>
                      {m.aResponsable ? (
                        <Badge tone="muted">a {m.aResponsable}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{m.porQue}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              No propone mover nada: la semana esta bien como esta.
            </p>
          )}

          {revision.agrupaciones.length > 0 ? (
            <div className="mt-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Layers className="h-3.5 w-3.5" />
                Se puede aprovechar la vuelta
              </p>
              <ul className="mt-2 grid gap-1.5">
                {revision.agrupaciones.map((a, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium text-slate-700">{a.activo}</span>
                      <span className="text-slate-400">·</span>
                      {a.ordenes.map((n) => (
                        <Link key={n} href={`/work-orders?q=${n}`} className="text-brand-600 hover:underline">
                          {n}
                        </Link>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{a.porQue}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {revision.noMover.length > 0 ? (
            <div className="mt-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <ShieldAlert className="h-3.5 w-3.5" />
                No recorrer
              </p>
              <ul className="mt-2 grid gap-1">
                {revision.noMover.map((n, i) => (
                  <li key={i} className="text-xs text-slate-600">
                    <span className="font-medium text-slate-700">{n.orden}</span> — {n.porQue}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {revision.advertencia ? (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {revision.advertencia}
            </p>
          ) : null}

          <p className="mt-4 border-t border-slate-100 pt-2 text-[0.6875rem] text-slate-400">
            Es una propuesta, no un cambio. Nada se movio: usted decide que aplicar y lo hace en cada orden.
          </p>
        </Card>
      ) : null}
    </>
  );
}
