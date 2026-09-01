"use client";

import { useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";

/**
 * Pregunta abierta sobre el sistema.
 *
 * Las sugerencias no son las mismas en todas las pantallas: se arman con la
 * ficha de donde esta parado el usuario. Y las preguntas frecuentes ya
 * contestadas NO pasan por aqui —se leen del catalogo, sin costo ni espera—;
 * esto es para lo que no esta escrito.
 */
export function AyudaConIa({ pantalla, sugerencias }: { pantalla: string; sugerencias: string[] }) {
  const [pregunta, setPregunta] = useState("");
  const [respuesta, setRespuesta] = useState<string | null>(null);
  const [consultas, setConsultas] = useState<string[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function preguntar(texto: string) {
    const q = texto.trim();
    if (q.length < 4) return;
    setCargando(true); setError(null); setRespuesta(null); setConsultas([]);
    const res = await fetch("/api/ia/ayuda", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pregunta: q, pantalla }),
    });
    const data = await res.json().catch(() => ({}));
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible responder"); return; }
    setRespuesta(data.respuesta);
    setConsultas((data.consultas ?? []).map((c: { herramienta: string }) => c.herramienta));
  }

  return (
    <section className="mt-6 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand-600" />
        <h3 className="text-sm font-semibold text-slate-900">Pregunte lo que sea de esta pantalla</h3>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Responde con la documentación del sistema y, cuando la pregunta es sobre su caso
        —por qué su plan no genera, por qué no puede surtir algo— revisa sus datos reales.
      </p>

      {sugerencias.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sugerencias.map((s, i) => (
            <button
              key={i} type="button" disabled={cargando}
              onClick={() => { setPregunta(s); preguntar(s); }}
              className="rounded-full border border-brand-200 bg-white px-2.5 py-1 text-xs text-slate-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(e) => { e.preventDefault(); preguntar(pregunta); }}
        className="mt-3 flex items-center gap-1.5"
      >
        <input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          placeholder="¿Por qué no me deja…?"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit" disabled={cargando || pregunta.trim().length < 4}
          className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
          aria-label="Preguntar"
        >
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}

      {respuesta ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{respuesta}</p>
          {consultas.length ? (
            <p className="mt-2 border-t border-slate-100 pt-2 text-[0.625rem] text-slate-400">
              Consultó: {[...new Set(consultas)].join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
