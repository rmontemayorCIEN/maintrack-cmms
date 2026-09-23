"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usarGrabadora } from "../usar-grabadora";

/**
 * «Llévame a…»: decir a dónde ir, desde cualquier pantalla.
 *
 * ── Por que vive en la barra de arriba y no en una pantalla propia ──
 *
 * Porque no es un lugar al que se va: es una forma de moverse, y tiene que
 * estar donde uno ya esta. Una pantalla «Comandos de voz» obligaria a navegar
 * hasta ella para poder navegar, que se contradice sola.
 *
 * ── Por que no vive dentro de «Preguntale a tus datos» ──
 *
 * Ahi tambien se habla, pero eso es Enterprise y esto es de todos los planes.
 * Y nadie sabe de antemano si lo suyo es pregunta o comando: uno dice «cuantas
 * vencidas tengo» y enseguida «llevame a la primera». Separarlas por pantalla
 * obligaria a elegir puerta antes de hablar.
 *
 * ── Lo que se ve cuando no entiende ──
 *
 * Se muestra lo que se oyo, no solo «no entendi». Casi siempre el problema no
 * es que el sistema no sepa a donde ir: es que oyo otra cosa, y verlo escrito
 * lo explica solo. Debajo van ejemplos, para no dejar a nadie adivinando que
 * se puede decir.
 */
type Fallo = { mensaje: string; texto: string; ejemplos: string[] };

export function VozNavegar() {
  const router = useRouter();
  const [fallo, setFallo] = useState<Fallo | null>(null);

  const g = usarGrabadora({
    alTerminar: async (audio) => {
      setFallo(null);
      try {
        const r = await fetch("/api/ia/navegar", { method: "POST", body: audio });
        const data = await r.json().catch(() => ({}));
        if (!g.sigueVivo()) return;
        if (!r.ok) {
          g.setError(data.error ?? "No se pudo oír en este momento.");
          return;
        }
        if (data.ruta) {
          router.push(data.ruta);
          return;
        }
        setFallo({
          mensaje: data.mensaje ?? "No le entendí.",
          texto: data.texto ?? "",
          ejemplos: data.ejemplos ?? [],
        });
      } catch {
        if (g.sigueVivo()) g.setError("Se perdió la conexión.");
      }
    },
  });

  // Un navegador que no puede grabar no enseña un botón muerto: el menú y la
  // búsqueda siguen ahí y hacen lo mismo.
  if (g.puedeGrabar === false) return null;

  const grabando = g.estado === "grabando";
  const cerrar = () => { setFallo(null); g.setError(null); };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={g.alternar}
        disabled={g.puedeGrabar === null || g.estado === "trabajando"}
        aria-label={grabando ? "Detener y llevarme" : "Decir a dónde ir"}
        aria-pressed={grabando}
        title="Diga a dónde quiere ir"
        className={cn(
          "grid h-10 w-10 place-items-center rounded-lg transition disabled:opacity-40",
          grabando ? "bg-red-50 text-red-600 hover:bg-red-100" : "text-slate-600 hover:bg-slate-100",
        )}
      >
        {g.estado === "trabajando" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : grabando ? (
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
        ) : (
          <Mic className="h-4 w-4" aria-hidden />
        )}
      </button>

      {grabando ? (
        // Mientras graba se dice que se está escuchando y hasta cuándo. Un
        // botón que cambia de color y nada más deja a la persona sin saber si
        // ya puede hablar.
        <span
          role="status"
          /* En el teléfono se ancla al borde de la PANTALLA, no al del botón:
             el botón vive a media barra y un aviso colgado de él se sale por
             la izquierda. Medido a 375 px: se salía 38 px y se cortaba. */
          className="fixed right-3 top-14 z-30 max-w-[calc(100vw-1.5rem)] rounded-md bg-slate-900 px-2 py-1 text-[0.625rem] text-white shadow-lg sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:max-w-none sm:whitespace-nowrap"
        >
          Escuchando… diga a dónde ir{g.restantes <= 10 ? ` · ${g.restantes} s` : ""}
          {g.cortaSolo ? <span className="ml-1 opacity-70">(se corta solo)</span> : null}
        </span>
      ) : null}

      {fallo || g.error ? (
        <div
          role="alert"
          /* Mismo criterio que el aviso de arriba: pegado al borde de la
             pantalla en el teléfono, colgado del botón en pantalla grande. */
          className="fixed right-3 top-14 z-30 w-[calc(100vw-1.5rem)] max-w-64 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:w-64"
        >
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar"
            className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
          <p className="pr-5 text-xs font-medium text-slate-800">{g.error ?? fallo?.mensaje}</p>
          {fallo?.texto ? (
            <p className="mt-1 text-[0.6875rem] text-slate-500">Oí: «{fallo.texto}»</p>
          ) : null}
          {fallo?.ejemplos.length ? (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <p className="text-[0.625rem] font-medium uppercase tracking-wide text-slate-400">Puede decir</p>
              <ul className="mt-1 space-y-0.5">
                {fallo.ejemplos.map((e) => (
                  <li key={e} className="text-[0.6875rem] text-slate-600">«{e}»</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
