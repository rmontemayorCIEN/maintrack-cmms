"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Eye, Loader2, Sparkles, X } from "lucide-react";
import { NOMBRE_CATEGORIA, NOMBRE_CERTEZA, type CategoriaHallazgo } from "@/lib/hallazgos";

/**
 * Lo que la IA vio en las fotos, para que una persona decida.
 *
 * ── Por que «lo que se ve» va tan grande como la conclusion ──
 *
 * Porque es lo unico que permite contradecirla. Si solo dijera «hay una fuga
 * en la bomba 3», quien lo lee solo puede creerle o no creerle. Diciendo
 * ademas «mancha oscura de unos 40 cm bajo la brida derecha», puede abrir la
 * foto y ver si eso esta ahi. Esconder esa linea en letra chica seria dejar la
 * decision sin fundamento.
 *
 * ── Por que aceptar levanta una solicitud y no una orden ──
 *
 * Porque la solicitud ya pasa por la revision que el sistema tiene. Crear
 * ordenes directo desde una foto se saltaria a la persona que decide si vale
 * la pena, que es justo donde hay que ser mas cuidadoso con algo que salio de
 * mirar una imagen.
 */
type Hallazgo = {
  id: string;
  categoria: string;
  titulo: string;
  detalle: string | null;
  baseVisual: string | null;
  certeza: string;
  estado: string;
  parada: number | null;
  equipo: string | null;
  solicitud: { id: string; number: string } | null;
};

const COLOR_CERTEZA: Record<string, string> = {
  SEGURO: "bg-emerald-100 text-emerald-800 border-emerald-200",
  PROBABLE: "bg-amber-100 text-amber-800 border-amber-200",
  DUDOSO: "bg-slate-100 text-slate-600 border-slate-200",
};

export function Hallazgos({
  rondinId,
  hallazgos,
  hayFotos,
  disponible,
  analizadoEn,
  puedeResolver,
}: {
  rondinId: string;
  hallazgos: Hallazgo[];
  hayFotos: boolean;
  /** Si el plan incluye revisar fotos con IA. */
  disponible: boolean;
  analizadoEn: string | null;
  puedeResolver: boolean;
}) {
  const router = useRouter();
  const [revisando, setRevisando] = useState(false);
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [noSirven, setNoSirven] = useState<Array<{ parada: number; porQue: string }>>([]);

  async function revisar() {
    setRevisando(true); setError(null); setNota(null);
    try {
      const r = await fetch("/api/ia/rondin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rondinId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo revisar."); return; }
      setNota(d.nota ?? null);
      setNoSirven(d.noSirven ?? []);
      router.refresh();
    } catch {
      setError("Se perdió la conexión.");
    } finally { setRevisando(false); }
  }

  async function resolver(id: string, decision: "ACEPTADO" | "DESCARTADO") {
    setResolviendo(id); setError(null);
    try {
      const r = await fetch(`/api/rondines/hallazgos/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo."); return; }
      router.refresh();
    } finally { setResolviendo(null); }
  }

  if (!hayFotos) return null;

  const propuestos = hallazgos.filter((h) => h.estado === "PROPUESTO");
  const resueltos = hallazgos.filter((h) => h.estado !== "PROPUESTO");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Eye className="h-4 w-4 text-brand-600" aria-hidden /> Lo que se ve en las fotos
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-slate-500">
            {analizadoEn
              ? "Propuestas de la revisión. Usted decide cuáles valen."
              : "Nadie ha revisado estas fotos todavía."}
          </p>
        </div>
        {disponible && puedeResolver ? (
          <button
            type="button"
            onClick={revisar}
            disabled={revisando}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
          >
            {revisando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            {revisando ? "Mirando las fotos…" : analizadoEn ? "Revisar otra vez" : "Revisar las fotos"}
          </button>
        ) : null}
      </div>

      {!disponible ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[0.6875rem] text-slate-600">
          Revisar las fotos con inteligencia artificial se activa con el complemento IA Avanzada.
          El recorrido y sus fotos funcionan igual sin él.
        </p>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600" role="alert">{error}</p> : null}
      {nota ? <p className="mt-2 rounded-lg bg-brand-50/60 px-3 py-2 text-[0.6875rem] text-brand-900/80">{nota}</p> : null}

      {noSirven.length ? (
        // Decir que una foto no sirve es un resultado util: quien recorra la
        // proxima vez sabe que ahi hay que acercarse o alumbrar.
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-[0.6875rem] font-medium text-amber-900">Fotos de las que no se pudo sacar nada</p>
          <ul className="mt-1 space-y-0.5">
            {noSirven.map((f) => (
              <li key={f.parada} className="text-[0.625rem] text-amber-900/80">Parada {f.parada}: {f.porQue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {analizadoEn && !propuestos.length && !resueltos.length ? (
        // Una lista vacía es una respuesta, no un fallo.
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          No encontró nada que señalar en estas fotos.
        </p>
      ) : null}

      {propuestos.length ? (
        <div className="mt-3 grid gap-2">
          {propuestos.map((h) => (
            <div key={h.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[0.625rem] font-medium text-slate-600">
                  {NOMBRE_CATEGORIA[h.categoria as CategoriaHallazgo] ?? h.categoria}
                </span>
                <span className={`rounded-md border px-1.5 py-0.5 text-[0.625rem] ${COLOR_CERTEZA[h.certeza] ?? COLOR_CERTEZA.DUDOSO}`}>
                  {NOMBRE_CERTEZA[h.certeza] ?? h.certeza}
                </span>
                {h.parada ? <span className="text-[0.625rem] text-slate-500">Parada {h.parada}</span> : null}
                {h.equipo ? <span className="text-[0.625rem] text-slate-500">· {h.equipo}</span> : null}
              </div>

              <p className="mt-1.5 text-sm font-medium text-slate-800">{h.titulo}</p>

              {/* Lo que se ve, tan visible como la conclusión: es lo que
                  permite ir a la foto y decir que no. */}
              {h.baseVisual ? (
                <p className="mt-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                  <span className="font-medium text-slate-500">En la foto se ve: </span>{h.baseVisual}
                </p>
              ) : null}

              {h.detalle ? <p className="mt-1.5 text-[0.6875rem] text-slate-600">{h.detalle}</p> : null}

              {puedeResolver ? (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => resolver(h.id, "ACEPTADO")}
                    disabled={resolviendo === h.id}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {resolviendo === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
                    Levantar solicitud
                  </button>
                  <button
                    type="button"
                    onClick={() => resolver(h.id, "DESCARTADO")}
                    disabled={resolviendo === h.id}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden /> No es
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {resueltos.length ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">Ya resueltos</p>
          <ul className="mt-1.5 grid gap-1">
            {resueltos.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-1.5 text-[0.6875rem]">
                <span className={h.estado === "ACEPTADO" ? "text-slate-700" : "text-slate-400 line-through"}>
                  {h.titulo}
                </span>
                {h.solicitud ? (
                  <Link href={`/requests/${h.solicitud.id}`} className="font-medium text-brand-700 hover:underline">
                    {h.solicitud.number}
                  </Link>
                ) : (
                  <span className="text-slate-400">descartado</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
