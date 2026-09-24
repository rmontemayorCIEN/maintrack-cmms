"use client";

import { useRef, useState } from "react";
import { Check, Loader2, Volume2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { pedir } from "@/lib/cliente/pedir";
import { cn } from "@/lib/utils";

/**
 * Con que voz se oye el parte del dia.
 *
 * Lo importante de esta pantalla es el boton de probar, no la lista. Elegir
 * entre «Despina», «Achird» y «Kore» por su nombre es elegir a ciegas: no le
 * dicen nada a nadie. Se oye, se escoge, y se guarda al escoger —sin boton de
 * guardar, porque es una preferencia de una sola cosa y volver a confirmarla
 * seria un paso de mas—.
 */

type Voz = { id: string; quien: string; como: string };
type Largo = { clave: string; etiqueta: string; explica: string; aproximado: string };

export function PanelVoz({
  voces, elegida, largos, largoElegido,
}: {
  voces: readonly Voz[];
  elegida: string;
  largos: readonly Largo[];
  largoElegido: string;
}) {
  const [largo, setLargo] = useState(largoElegido);
  const [guardandoLargo, setGuardandoLargo] = useState<string | null>(null);
  const [actual, setActual] = useState(elegida);
  const [probando, setProbando] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinVoz, setSinVoz] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  async function probar(id: string) {
    if (probando) return;
    setProbando(id);
    setError(null);
    try {
      const r = await fetch(`/api/ia/brief/voz/muestra?voz=${encodeURIComponent(id)}`);
      // 204: el servidor no puede sintetizar. Se dice una vez y se esconde el
      // resto, en vez de dejar botones que no hacen nada.
      if (r.status === 204) { setSinVoz(true); return; }
      if (!r.ok) { setError("No se pudo generar la muestra. Intente de nuevo."); return; }
      const blob = await r.blob();
      if (audio.current) audio.current.pause();
      const pista = new Audio(URL.createObjectURL(blob));
      pista.onended = () => setProbando(null);
      pista.onerror = () => setProbando(null);
      audio.current = pista;
      await pista.play();
      return;
    } catch {
      setError("No se pudo generar la muestra. Revise su conexión.");
    } finally {
      // Si sonó, el `onended` lo apaga; si no, se apaga aquí.
      if (!audio.current || audio.current.paused) setProbando(null);
    }
  }

  /**
   * Cuanto habla al contestar.
   *
   * Va aqui y no en una tarjeta aparte porque es la misma decision: como se
   * oye el sistema. Quien viene a escoger voz es quien lo usa hablando.
   */
  async function escogerLargo(clave: string) {
    const antes = largo;
    setLargo(clave);
    setGuardandoLargo(clave);
    setError(null);
    const r = await pedir("/api/apariencia", { method: "PATCH", json: { respuestaVoz: clave } });
    setGuardandoLargo(null);
    if (!r.ok) { setLargo(antes); setError(r.error); }
  }

  async function escoger(id: string) {
    const antes = actual;
    setActual(id);
    setGuardando(id);
    setError(null);
    const r = await pedir("/api/apariencia", { method: "PATCH", json: { vozBrief: id } });
    setGuardando(null);
    if (!r.ok) { setActual(antes); setError(r.error); }
  }

  return (
    <Card>
      <CardHeader
        title="La voz del parte del día"
        subtitle="Con cuál quiere escuchar su parte. Pruébelas: los nombres no dicen cómo suenan."
      />

      {sinVoz ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Ahora mismo no se puede generar la voz del sistema. El parte se escucha con la voz del propio
          aparato, que suena distinta.
        </p>
      ) : null}

      {error ? <p className="mb-2 text-xs text-red-700">{error}</p> : null}

      <ul className="grid gap-2 sm:grid-cols-2">
        {voces.map((v) => {
          const esta = v.id === actual;
          return (
            <li key={v.id}>
              <div
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5",
                  esta ? "border-brand-400 bg-brand-50/60" : "border-slate-200 bg-white",
                )}
              >
                <button
                  type="button"
                  onClick={() => escoger(v.id)}
                  disabled={Boolean(guardando)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
                  aria-pressed={esta}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                      esta ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300",
                    )}
                    aria-hidden
                  >
                    {guardando === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : esta ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{v.id}</span>
                    <span className="block truncate text-[0.6875rem] text-slate-500">Voz de {v.quien} · {v.como}</span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => probar(v.id)}
                  disabled={Boolean(probando)}
                  title={`Escuchar a ${v.id}`}
                  aria-label={`Escuchar a ${v.id}`}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                >
                  {probando === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[0.6875rem] text-slate-500">
        La voz es suya: cada quien escucha su parte con la que escogió. Al cambiarla, el siguiente parte
        se genera con la nueva.
      </p>

      {/* Cuánto habla al contestar una pregunta hablada. */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Qué tanto le contesta hablando</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Cuando le pregunta por sus datos con el micrófono. Lo escrito sale completo en los dos casos:
          esto solo cambia lo que se dice en voz alta.
        </p>

        <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {largos.map((l) => {
            const esta = l.clave === largo;
            return (
              <li key={l.clave}>
                <button
                  type="button"
                  onClick={() => escogerLargo(l.clave)}
                  disabled={Boolean(guardandoLargo)}
                  aria-pressed={esta}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left disabled:opacity-60",
                    esta ? "border-brand-400 bg-brand-50/60" : "border-slate-200 bg-white hover:border-brand-300",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                      esta ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300",
                    )}
                    aria-hidden
                  >
                    {guardandoLargo === l.clave ? <Loader2 className="h-3 w-3 animate-spin" /> : esta ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{l.etiqueta}</span>
                    <span className="block text-[0.6875rem] leading-snug text-slate-500">{l.explica}</span>
                    {/* El tiempo aproximado es lo que de verdad decide: nadie
                        escoge «concisa» por la palabra, sino por los segundos. */}
                    <span className="mt-0.5 block text-[0.6875rem] text-slate-400">{l.aproximado}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
