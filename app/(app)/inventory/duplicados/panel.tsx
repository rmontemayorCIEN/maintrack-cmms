"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Merge, Sparkles } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";

type Refaccion = { id: string; code: string; name: string; unit: string; existencia: number; costo: number; movimientos: number };
type Candidato = { puntaje: number; motivo: string; refacciones: Refaccion[] };
type Grupo = { codigos: string[]; sobreviviente: string; nombreSugerido: string; porQue: string; confianza: string };
type Descartado = { codigos: string[]; porQue: string };

/**
 * Limpieza del catalogo de refacciones.
 *
 * La fusion NO se puede deshacer, y por eso nada pasa sin que una persona lo
 * confirme viendo exactamente que se va a juntar y que existencia va a quedar.
 * La IA ordena y explica; la decision sigue siendo humana.
 */
export function PanelDuplicados({
  candidatos, moneda, disponible, editable,
}: {
  candidatos: Candidato[];
  moneda: string;
  disponible: boolean;
  editable: boolean;
}) {
  const router = useRouter();
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [descartados, setDescartados] = useState<Descartado[]>([]);
  const [analizando, setAnalizando] = useState(false);
  const [fusionando, setFusionando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hechas, setHechas] = useState<string[]>([]);

  const porCodigo = new Map<string, Refaccion>();
  for (const c of candidatos) for (const r of c.refacciones) porCodigo.set(r.code, r);

  async function analizar() {
    setAnalizando(true); setError(null);
    const res = await fetch("/api/refacciones/duplicados", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "ANALIZAR" }),
    });
    const data = await res.json().catch(() => ({}));
    setAnalizando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible analizar"); return; }
    setGrupos(data.juicio?.grupos ?? []);
    setDescartados(data.juicio?.descartados ?? []);
  }

  async function fusionar(g: Grupo) {
    const partes = g.codigos.map((c) => porCodigo.get(c)).filter(Boolean) as Refaccion[];
    const sobreviviente = porCodigo.get(g.sobreviviente);
    if (!sobreviviente || partes.length < 2) { setError("No se encontraron esas refacciones"); return; }
    const total = partes.reduce((s, p) => s + p.existencia, 0);

    if (!confirm(
      `Fusionar ${partes.length} refacciones en ${sobreviviente.code}?\n\n` +
      partes.map((p) => `  ${p.code} — ${p.name} (${p.existencia} ${p.unit})`).join("\n") +
      `\n\nLa existencia queda en ${total} ${sobreviviente.unit} y todo el historial pasa a ${sobreviviente.code}.\n\n` +
      `ESTO NO SE PUEDE DESHACER.`,
    )) return;

    setFusionando(g.sobreviviente); setError(null);
    const res = await fetch("/api/refacciones/duplicados", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "FUSIONAR",
        sobrevivienteId: sobreviviente.id,
        absorbidasIds: partes.filter((p) => p.id !== sobreviviente.id).map((p) => p.id),
        nombreNuevo: g.nombreSugerido || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setFusionando(null);
    if (!res.ok) { setError(data.error ?? "No fue posible fusionar"); return; }
    setHechas((h) => [...h, g.sobreviviente]);
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {candidatos.length} {candidatos.length === 1 ? "grupo parecido" : "grupos parecidos"}
            </p>
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">
              El sistema los juntó por parecido de texto, descartando los que chocan en medidas —un
              6205 y un 6206 nunca se juntan—. Falta decidir cuáles son de verdad la misma pieza.
            </p>
          </div>
          {disponible && editable && candidatos.length ? (
            <Button type="button" size="sm" onClick={analizar} disabled={analizando}>
              {analizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Revisar con IA
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
        ) : null}
      </Card>

      {grupos?.length ? (
        <div className="grid gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Son la misma pieza ({grupos.length})
          </p>
          {grupos.map((g, i) => {
            const partes = g.codigos.map((c) => porCodigo.get(c)).filter(Boolean) as Refaccion[];
            const total = partes.reduce((s, p) => s + p.existencia, 0);
            const ya = hechas.includes(g.sobreviviente);
            return (
              <Card key={i}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{g.nombreSugerido}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{g.porQue}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={g.confianza === "ALTA" ? "success" : g.confianza === "MEDIA" ? "warning" : "danger"}>
                      Confianza {g.confianza.toLowerCase()}
                    </Badge>
                    {ya ? <Badge tone="success"><Check className="mr-1 inline h-3 w-3" />Fusionada</Badge> : null}
                  </div>
                </div>

                <ul className="mt-3 grid gap-1.5">
                  {partes.map((p) => (
                    <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${p.code === g.sobreviviente ? "border-emerald-300 bg-emerald-50" : "border-slate-200"}`}>
                      <span className="min-w-0">
                        <span className="text-xs font-medium text-slate-900">{p.code}</span>
                        <span className="ml-1.5 text-xs text-slate-600">{p.name}</span>
                        {p.code === g.sobreviviente ? (
                          <span className="ml-1.5 text-[0.625rem] font-medium text-emerald-700">se conserva</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[0.6875rem] tabular-nums text-slate-500">
                        {formatNumber(p.existencia, 2)} {p.unit} · {formatCurrency(p.costo, moneda)} · {p.movimientos} mov.
                      </span>
                    </li>
                  ))}
                </ul>

                {!ya && editable ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <p className="text-xs text-slate-600">
                      Quedaría <strong className="tabular-nums">{formatNumber(total, 2)} {partes[0]?.unit}</strong> en
                      un solo registro, con todo el historial junto.
                    </p>
                    <Button type="button" size="sm" onClick={() => fusionar(g)} disabled={fusionando === g.sobreviviente}>
                      {fusionando === g.sobreviviente ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Merge className="h-3.5 w-3.5" />}
                      Fusionar
                    </Button>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : null}

      {descartados.length ? (
        <Card>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold text-slate-800">Se parecen pero NO son la misma pieza</p>
          </div>
          <ul className="mt-2 grid gap-2">
            {descartados.map((d, i) => (
              <li key={i} className="text-xs">
                <span className="font-medium text-slate-800">{d.codigos.join(" · ")}</span>
                <span className="block text-slate-600">{d.porQue}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {!grupos ? (
        <div className="grid gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Lo que encontró el sistema, sin revisar
          </p>
          {candidatos.map((c, i) => (
            <Card key={i}>
              <p className="text-xs text-slate-600">{c.motivo}</p>
              <ul className="mt-2 grid gap-1">
                {c.refacciones.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>
                      <span className="font-medium text-slate-900">{r.code}</span>
                      <span className="ml-1.5 text-slate-600">{r.name}</span>
                    </span>
                    <span className="tabular-nums text-slate-500">
                      {formatNumber(r.existencia, 2)} {r.unit} · {r.movimientos} mov.
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
