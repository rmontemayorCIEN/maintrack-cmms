"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, Square, Volume2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usarGrabadora } from "../usar-grabadora";

/**
 * Hablarle al sistema: un solo micrófono para ir a un lado o preguntar algo.
 *
 * ── Por qué uno y no dos ──
 *
 * Había un micrófono para navegar y otro para preguntar, en la misma barra.
 * Para quien lo usa eso es una sola cosa —hablarle al sistema— y tener dos
 * obliga a clasificar la propia frase antes de decirla. Lo que decide es el
 * verbo, en el servidor: «llévame» va a una pantalla, «cuánto» se contesta.
 *
 * ── Manos libres ──
 *
 * Después de atender lo dicho vuelve a escuchar solo. Un toque para entrar y
 * ya no se suelta hasta cerrar: es lo que necesita quien trae las manos
 * sucias o va manejando, y es lo que «Hola Siri» resuelve de otra forma —una
 * que una página web no puede, porque tendría que oír todo el día—.
 *
 * Se corta cuando la persona lo cierra, cuando se va a otra pantalla, o
 * cuando dos intentos seguidos no se entienden: insistir sola con alguien que
 * ya se fue es lo que convierte una comodidad en una molestia.
 */
type Respuesta = { texto: string; respuesta: string } | null;
type Fallo = { mensaje: string; texto: string; ejemplos: string[] } | null;

/** Cuántas veces seguidas puede no entender antes de dejar de insistir. */
const INTENTOS_EN_VANO = 2;

export function VozNavegar() {
  const router = useRouter();
  const [fallo, setFallo] = useState<Fallo>(null);
  const [respuesta, setRespuesta] = useState<Respuesta>(null);
  /** Manos libres: sigue escuchando hasta que alguien lo cierre. */
  const [seguido, setSeguido] = useState(false);
  const enVano = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  const g = usarGrabadora({
    alTerminar: async (grabado) => {
      try {
        const r = await fetch("/api/ia/navegar", { method: "POST", body: grabado });
        const d = await r.json().catch(() => ({}));
        if (!g.sigueVivo()) return;
        if (!r.ok) { setSeguido(false); g.setError(d.error ?? "No se pudo oír en este momento."); return; }

        if (d.tipo === "ir" && d.ruta) {
          // Al cambiar de pantalla se acaba la conversación: seguir
          // escuchando mientras alguien lee otra cosa sería escuchar de más.
          setSeguido(false);
          router.push(d.ruta);
          return;
        }
        if (d.tipo === "respuesta") {
          enVano.current = 0;
          setFallo(null);
          setRespuesta({ texto: d.texto, respuesta: d.respuesta });
          return;
        }
        enVano.current += 1;
        setRespuesta(null);
        setFallo({ mensaje: d.mensaje ?? "No le entendí.", texto: d.texto ?? "", ejemplos: d.ejemplos ?? [] });
        if (enVano.current >= INTENTOS_EN_VANO) setSeguido(false);
      } catch {
        if (g.sigueVivo()) { setSeguido(false); g.setError("Se perdió la conexión."); }
      }
    },
  });

  /**
   * Volver a escuchar cuando se terminó de atender lo anterior.
   *
   * Se espera a que el estado vuelva a reposo —no se encadena dentro de la
   * respuesta— porque si no, el micrófono se abriría mientras todavía se está
   * hablando o transcribiendo, y se grabaría a sí mismo.
   */
  useEffect(() => {
    if (!seguido || g.estado !== "quieto") return;
    const t = setTimeout(() => { if (seguido) void g.alternar(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seguido, g.estado]);

  useEffect(() => () => { audio.current?.pause(); audio.current = null; }, []);

  if (g.puedeGrabar === false) return null;

  const grabando = g.estado === "grabando";
  const abrir = () => { enVano.current = 0; setFallo(null); setRespuesta(null); setSeguido(true); void g.alternar(); };
  const cerrar = () => {
    setSeguido(false); setFallo(null); setRespuesta(null); g.setError(null);
    if (grabando) g.detener();
    // Al cerrar se suelta el micrófono: es lo que apaga el indicador del
    // teléfono. Entre frase y frase NO se suelta, o volvería a pedir permiso.
    g.soltar();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (seguido || grabando ? cerrar() : abrir())}
        disabled={g.puedeGrabar === null || g.estado === "trabajando"}
        aria-label={seguido || grabando ? "Dejar de escuchar" : "Hablarle al sistema"}
        aria-pressed={seguido || grabando}
        title="Diga a dónde ir, o pregunte algo"
        className={cn(
          "grid h-10 w-10 place-items-center rounded-lg transition disabled:opacity-40",
          grabando ? "bg-red-50 text-red-600 hover:bg-red-100"
            : seguido ? "bg-brand-50 text-brand-700"
            : "text-slate-600 hover:bg-slate-100",
        )}
      >
        {g.estado === "trabajando" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : grabando || seguido ? (
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
        ) : (
          <Mic className="h-4 w-4" aria-hidden />
        )}
      </button>

      {grabando ? (
        <span
          role="status"
          className="fixed right-3 top-14 z-30 max-w-[calc(100vw-1.5rem)] rounded-md bg-slate-900 px-2 py-1 text-[0.625rem] text-white shadow-lg sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:max-w-none sm:whitespace-nowrap"
        >
          Escuchando… diga a dónde ir o pregunte algo
          {g.cortaSolo ? <span className="ml-1 opacity-70">(se corta solo)</span> : null}
        </span>
      ) : g.estado === "trabajando" ? (
        <span role="status" className="fixed right-3 top-14 z-30 rounded-md bg-slate-900 px-2 py-1 text-[0.625rem] text-white shadow-lg sm:absolute sm:right-0 sm:top-full sm:mt-1">
          Revisando sus datos…
        </span>
      ) : null}

      {respuesta || fallo || g.error ? (
        <div
          role={respuesta ? "status" : "alert"}
          className="fixed right-3 top-14 z-30 w-[calc(100vw-1.5rem)] max-w-80 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:w-80"
        >
          <button
            type="button"
            onClick={cerrar}
            aria-label="Cerrar"
            className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>

          {respuesta ? (
            <>
              <p className="pr-6 text-[0.6875rem] text-slate-500">«{respuesta.texto}»</p>
              {/* La respuesta completa, no un resumen: de estas cifras se
                  toman decisiones y recortarlas aquí sería contestar a medias. */}
              <p className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-slate-800">
                {respuesta.respuesta}
              </p>
              {seguido ? (
                <p className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2 text-[0.625rem] text-brand-700">
                  <Volume2 className="h-3 w-3" aria-hidden /> Siga hablando, lo escucho
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="pr-6 text-xs font-medium text-slate-800">{g.error ?? fallo?.mensaje}</p>
              {fallo?.texto ? <p className="mt-1 text-[0.6875rem] text-slate-500">Oí: «{fallo.texto}»</p> : null}
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
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
