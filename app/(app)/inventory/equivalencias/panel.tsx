"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";

type Registrada = {
  id: string; tipo: string; nota: string | null;
  a: { code: string; name: string; quantityOnHand: number; unit: string };
  b: { code: string; name: string; quantityOnHand: number; unit: string };
};

type Propuesta = {
  codigoA: string; codigoB: string;
  tipo: "EQUIVALENTE" | "SUSTITUTO" | "NO_EQUIVALEN";
  porQue: string; salvedad: string | null;
  confianza: "ALTA" | "MEDIA" | "BAJA";
  partAId: string; partBId: string;
};

/**
 * Propuestas de la IA, una por una.
 *
 * Nada se registra al correr el analisis. Cada propuesta se acepta o se
 * descarta a mano, porque montar la pieza equivocada rompe el equipo o lastima
 * a alguien: eso no lo decide un modelo.
 */
export function PanelEquivalencias({
  registradas, totalRefacciones, editable,
}: {
  registradas: Registrada[];
  totalRefacciones: number;
  editable: boolean;
}) {
  const router = useRouter();
  const [analizando, setAnalizando] = useState(false);
  const [resumen, setResumen] = useState<string | null>(null);
  const [propuestas, setPropuestas] = useState<Propuesta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estado, setEstado] = useState<Record<number, "aceptando" | "aceptada" | "descartada" | string>>({});

  async function analizar() {
    setAnalizando(true); setError(null); setPropuestas(null); setResumen(null); setEstado({});
    const res = await fetch("/api/ia/equivalencias", { method: "POST" });
    const cuerpo = await res.json().catch(() => null);
    setAnalizando(false);
    if (!res.ok) { setError(cuerpo?.error ?? "No fue posible analizar."); return; }
    setResumen(cuerpo.resumen);
    setPropuestas(cuerpo.propuestas);
  }

  async function aceptar(i: number) {
    const p = propuestas?.[i];
    if (!p) return;
    setEstado((e) => ({ ...e, [i]: "aceptando" }));
    const res = await fetch("/api/refacciones/equivalencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partId: p.partAId, equivalenteId: p.partBId,
        tipo: p.tipo, nota: p.salvedad ?? p.porQue,
      }),
    });
    if (!res.ok) {
      const c = await res.json().catch(() => null);
      setEstado((e) => ({ ...e, [i]: c?.error ?? "No se pudo registrar" }));
      return;
    }
    setEstado((e) => ({ ...e, [i]: "aceptada" }));
    router.refresh();
  }

  async function quitar(id: string) {
    await fetch("/api/refacciones/equivalencias", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    router.refresh();
  }

  const tono = (c: string): "success" | "warning" | "muted" =>
    c === "ALTA" ? "success" : c === "MEDIA" ? "warning" : "muted";

  return (
    <div className="grid gap-4">
      {editable ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-slate-800">Buscar equivalencias con IA</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Revisa sus {totalRefacciones} refacciones y propone cuáles son la misma pieza de otra
                marca o pueden sustituirse. <b>No registra nada</b>: usted acepta una por una.
              </p>
            </div>
            <Button onClick={analizar} disabled={analizando}>
              {analizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {analizando ? "Analizando…" : "Buscar equivalencias"}
            </Button>
          </div>

          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
            Antes de aceptar, confirme con la ficha del fabricante. Una equivalencia mal registrada
            manda a montar la pieza equivocada, y eso rompe el equipo o lastima a alguien. Las piezas
            de medida distinta —un 6205 y un 6206— nunca se comparan entre sí, pero el resto es
            criterio suyo.
          </p>

          {error ? (
            <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
          ) : null}

          {resumen ? <p className="mt-3 text-sm text-slate-700">{resumen}</p> : null}

          {propuestas ? (
            propuestas.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                No propone ninguna equivalencia nueva.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {propuestas.map((p, i) => {
                  const e = estado[i];
                  const lista = e === "aceptada" || e === "descartada";
                  const fallo = e && !lista && e !== "aceptando";
                  return (
                    <li key={i} className={cn(
                      "rounded-lg border px-3 py-2",
                      e === "aceptada" ? "border-emerald-200 bg-emerald-50/60"
                        : e === "descartada" ? "border-slate-200 bg-slate-50 opacity-60"
                        : "border-slate-200",
                    )}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{p.codigoA}</span>
                        <span className="text-slate-400">↔</span>
                        <span className="text-sm font-medium text-slate-800">{p.codigoB}</span>
                        <Badge tone={p.tipo === "EQUIVALENTE" ? "info" : "warning"}>
                          {p.tipo === "EQUIVALENTE" ? "Misma pieza" : "Sustituto"}
                        </Badge>
                        <Badge tone={tono(p.confianza)}>Confianza {p.confianza.toLowerCase()}</Badge>

                        <span className="ml-auto flex items-center gap-1">
                          {e === "aceptada" ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                              <Check className="h-3.5 w-3.5" /> Registrada
                            </span>
                          ) : e === "descartada" ? (
                            <span className="text-xs text-slate-400">Descartada</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setEstado((s) => ({ ...s, [i]: "descartada" }))}
                                className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"
                              >
                                Descartar
                              </button>
                              <button
                                type="button"
                                onClick={() => aceptar(i)}
                                disabled={e === "aceptando"}
                                className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                {e === "aceptando" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                Aceptar
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{p.porQue}</p>
                      {p.salvedad ? <p className="mt-0.5 text-xs text-amber-800">⚠ {p.salvedad}</p> : null}
                      {fallo ? <p className="mt-1 text-xs text-rose-600">{e}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
        </Card>
      ) : null}

      <Card>
        <p className="text-sm font-semibold text-slate-800">Equivalencias registradas</p>
        {registradas.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-400">
            Todavía no hay ninguna. Se pueden registrar aquí con la IA, o una por una desde el botón
            «Equivalentes» de cada refacción.
          </p>
        ) : (
          <ul className="mt-3 grid gap-1.5">
            {registradas.map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-slate-800">{e.a.code}</span>
                  <span className="text-slate-500">{e.a.name}</span>
                  <span className="text-slate-400">({e.a.quantityOnHand} {e.a.unit})</span>
                  <span className="text-slate-400">↔</span>
                  <span className="font-medium text-slate-800">{e.b.code}</span>
                  <span className="text-slate-500">{e.b.name}</span>
                  <span className="text-slate-400">({e.b.quantityOnHand} {e.b.unit})</span>
                  <Badge tone={e.tipo === "EQUIVALENTE" ? "info" : "warning"}>
                    {e.tipo === "EQUIVALENTE" ? "Misma pieza" : "Sustituto"}
                  </Badge>
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => quitar(e.id)}
                      className="ml-auto rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label="Quitar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                {e.nota ? <p className="mt-1 text-xs text-amber-800">⚠ {e.nota}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
