"use client";

import { useState } from "react";
import { ArrowRight, Database, Loader2, Sparkles } from "lucide-react";
import { Button, Card } from "@/components/ui";

type Turno = {
  pregunta: string;
  respuesta: string;
  consultas: Array<{ herramienta: string; entrada: Record<string, unknown> }>;
};

const NOMBRE_HERRAMIENTA: Record<string, string> = {
  indicadores: "Indicadores del periodo",
  buscar_ordenes: "Ordenes de trabajo",
  costo_por_activo: "Costo por activo",
  consultar_activo: "Ficha del activo",
  consultar_almacen: "Almacen",
  fallas_frecuentes: "Fallas y causas raiz",
};

/**
 * Consulta en lenguaje natural.
 *
 * Debajo de cada respuesta se muestra que consulto para llegar a ella. Sin eso
 * el usuario tendria que creer en la respuesta a ciegas, y en decisiones de
 * mantenimiento eso no basta.
 */
export function PanelConsulta({
  disponible,
  restantes,
  ejemplos,
}: {
  disponible: boolean;
  restantes: number;
  ejemplos: string[];
}) {
  const [pregunta, setPregunta] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnos, setTurnos] = useState<Turno[]>([]);

  async function preguntar(texto: string) {
    const q = texto.trim();
    if (q.length < 5) return;
    setCargando(true);
    setError(null);
    const res = await fetch("/api/ia/consulta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pregunta: q }),
    });
    const data = await res.json();
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible responder"); return; }
    setTurnos((prev) => [{ pregunta: q, respuesta: data.respuesta, consultas: data.consultas ?? [] }, ...prev]);
    setPregunta("");
  }

  if (!disponible) {
    return (
      <Card>
        <div className="py-8 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-800">La consulta con IA no esta activa</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Se incluye en el plan Enterprise y en el complemento IA Avanzada.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="field"
            placeholder="Ej: ¿cuanto llevo gastado en el compresor este ano?"
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !cargando) preguntar(pregunta); }}
            maxLength={500}
            disabled={cargando || restantes < 1}
          />
          <Button onClick={() => preguntar(pregunta)} disabled={cargando || pregunta.trim().length < 5 || restantes < 1}>
            {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {cargando ? "Consultando…" : "Preguntar"}
          </Button>
        </div>

        {restantes < 1 ? (
          <p className="mt-2 text-[0.6875rem] text-amber-700">
            Se agotaron las operaciones de IA de este mes. Se renuevan el dia 1.
          </p>
        ) : turnos.length === 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ejemplos.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => preguntar(e)}
                disabled={cargando}
                className="rounded-full border border-slate-200 px-2.5 py-1 text-[0.6875rem] text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
              >
                {e}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </Card>

      {turnos.map((t, i) => (
        <Card key={i}>
          <p className="mb-2 text-sm font-semibold text-slate-800">{t.pregunta}</p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{t.respuesta}</div>
          {t.consultas.length ? (
            <details className="mt-3 border-t border-slate-100 pt-2">
              <summary className="flex cursor-pointer items-center gap-1.5 text-[0.6875rem] text-slate-500 hover:text-slate-700">
                <Database className="h-3 w-3" />
                Consulto {t.consultas.length} {t.consultas.length === 1 ? "fuente" : "fuentes"} de sus datos
              </summary>
              <ul className="mt-1.5 grid gap-1">
                {t.consultas.map((c, j) => (
                  <li key={j} className="text-[0.6875rem] text-slate-500">
                    <span className="font-medium text-slate-600">{NOMBRE_HERRAMIENTA[c.herramienta] ?? c.herramienta}</span>
                    {Object.keys(c.entrada).length ? (
                      <span className="text-slate-400">
                        {" · "}
                        {Object.entries(c.entrada).map(([k, v]) => `${k}: ${String(v)}`).join(", ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
