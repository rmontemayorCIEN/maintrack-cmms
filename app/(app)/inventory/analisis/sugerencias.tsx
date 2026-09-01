"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";

type Sugerencia = {
  codigoSugerido: string;
  nombre: string;
  familia: string;
  unidad: string;
  minimoSugerido: number;
  criticidad: "IMPRESCINDIBLE" | "RECOMENDABLE" | "OPCIONAL";
  porQue: string;
  yaExiste: boolean;
};

const TONO = {
  IMPRESCINDIBLE: "danger",
  RECOMENDABLE: "warning",
  OPCIONAL: "muted",
} as const;

/**
 * Refacciones propuestas por la IA para un equipo.
 *
 * Va separado del analisis de arriba a proposito: aquello son cuentas sobre el
 * kardex, esto es criterio sobre el tipo de equipo. El usuario tiene que poder
 * distinguirlos, porque no se confia igual en un numero que salio de sus
 * movimientos que en una recomendacion general.
 */
export function SugerenciasIa({
  activos,
  disponible,
}: {
  activos: Array<{ id: string; code: string; name: string; criticality: string; conRefacciones: number }>;
  disponible: boolean;
}) {
  const router = useRouter();
  const [assetId, setAssetId] = useState(activos[0]?.id ?? "");
  const [notas, setNotas] = useState("");
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ refacciones: Sugerencia[]; nota: string; activo: string } | null>(null);
  const [aceptadas, setAceptadas] = useState<Set<string>>(new Set());
  const [listo, setListo] = useState<string | null>(null);

  if (!disponible) return null;

  async function sugerir() {
    setCargando(true);
    setError(null);
    setListo(null);
    const res = await fetch("/api/ia/refacciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId, notas: notas || null }),
    });
    const data = await res.json();
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible generar la propuesta"); return; }
    setResultado(data);
    // Se preseleccionan solo las imprescindibles: lo demas es decision suya.
    setAceptadas(new Set(
      (data.refacciones as Sugerencia[])
        .filter((r) => r.criticidad === "IMPRESCINDIBLE" && !r.yaExiste)
        .map((r) => r.codigoSugerido),
    ));
  }

  async function darDeAlta() {
    if (!resultado) return;
    setGuardando(true);
    setError(null);
    const elegidas = resultado.refacciones.filter((r) => aceptadas.has(r.codigoSugerido) && !r.yaExiste);
    const res = await fetch("/api/ia/refacciones", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refacciones: elegidas.map((r) => ({
          code: r.codigoSugerido,
          name: r.nombre,
          category: r.familia,
          unit: r.unidad,
          minQuantity: r.minimoSugerido,
          description: r.porQue,
        })),
      }),
    });
    const data = await res.json();
    setGuardando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible dar de alta"); return; }
    setListo(`${data.creadas} refacciones dadas de alta con existencia en cero. Capture su costo al recibir la compra.`);
    setResultado(null);
    router.refresh();
  }

  const seleccionables = resultado?.refacciones.filter((r) => !r.yaExiste) ?? [];

  return (
    <Card className="mt-4">
      <CardHeader
        title="Que refacciones deberia tener — propuesta de IA"
        subtitle="Para equipos sin historial de consumo, donde el kardex no tiene de donde deducir. Esto es criterio sobre el tipo de equipo, no un calculo sobre sus datos."
        action={<Sparkles className="h-4 w-4 text-brand-400" />}
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className="label">Equipo</label>
          <select className="field" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {activos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
                {a.conRefacciones === 0 ? " (sin refacciones ligadas)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Contexto (opcional)</label>
          <input
            className="field"
            placeholder="Ej: no hay equipo de respaldo; el proveedor tarda 6 semanas"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            maxLength={600}
          />
        </div>
        <Button onClick={sugerir} disabled={cargando || !assetId}>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {cargando ? "Analizando…" : "Proponer"}
        </Button>
      </div>

      {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {listo ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{listo}</p> : null}

      {resultado ? (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-800">Propuesta para {resultado.activo}</p>
              <p className="mt-0.5 text-xs text-slate-500">{resultado.nota}</p>
            </div>
            <button type="button" onClick={() => setResultado(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="grid gap-2">
            {resultado.refacciones.map((r) => {
              const marcada = aceptadas.has(r.codigoSugerido);
              return (
                <li
                  key={r.codigoSugerido}
                  className={`rounded-lg border p-2.5 ${
                    r.yaExiste ? "border-slate-200 bg-slate-50 opacity-60" : marcada ? "border-brand-300 bg-brand-50/50" : "border-slate-200"
                  }`}
                >
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                      checked={marcada}
                      disabled={r.yaExiste}
                      onChange={(e) =>
                        setAceptadas((prev) => {
                          const s = new Set(prev);
                          if (e.target.checked) s.add(r.codigoSugerido); else s.delete(r.codigoSugerido);
                          return s;
                        })
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-800">{r.codigoSugerido}</span>
                        <span className="text-xs text-slate-700">{r.nombre}</span>
                        <Badge tone={TONO[r.criticidad]}>{r.criticidad.toLowerCase()}</Badge>
                        {r.yaExiste ? <Badge tone="muted">ya la tiene</Badge> : null}
                      </div>
                      <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-600">{r.porQue}</p>
                      <p className="mt-0.5 text-[0.6875rem] text-slate-400">
                        familia {r.familia} · unidad {r.unidad} · minimo sugerido {r.minimoSugerido}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          {seleccionables.length ? (
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-[0.6875rem] text-slate-500">
                Se dan de alta con existencia y costo en cero: la IA no inventa precios ni cuenta su anaquel.
              </p>
              <Button onClick={darDeAlta} disabled={guardando || aceptadas.size === 0}>
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Dar de alta {aceptadas.size > 0 ? `(${aceptadas.size})` : ""}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
