"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { usarGrabadora } from "./usar-grabadora";
import { SILENCIO_DICTADO_MS } from "@/lib/deteccion-voz";

export { unirDictado } from "@/lib/dictado";

/**
 * Dictar en vez de escribir.
 *
 * ── Para que existe ──
 *
 * El tecnico acaba de cerrar una valvula, trae las manos sucias y el telefono
 * en la bolsa. Escribir con el pulgar lo que encontro y lo que hizo es la
 * razon por la que la mitad de las ordenes se cierran con «se reparo» —y con
 * eso no se puede calcular nada, ni MTTR ni causa raiz ni costo—. Hablar, si
 * lo hace.
 *
 * La mecanica de grabar vive en `usarGrabadora`, compartida con la navegacion
 * por voz. Aqui solo queda que hacer con lo que se oyo.
 *
 * ── Lo que NO hace ──
 *
 * No guarda nada. Devuelve palabras y quien lo usa decide. Se puede corregir
 * antes de que se guarde, que es indispensable: la transcripcion se equivoca
 * con los codigos de refaccion y con los nombres propios, y un cierre no se
 * manda a ciegas.
 */
export function BotonDictado({
  onTexto,
  etiqueta = "Dictar",
  className,
}: {
  onTexto: (texto: string) => void;
  etiqueta?: string;
  className?: string;
}) {
  const g = usarGrabadora({
    // Mas margen que un comando: quien dicta un cierre se acuerda de la
    // refaccion a media frase, y cortarle ahi seria pelearse con quien está
    // trabajando.
    silencioMs: SILENCIO_DICTADO_MS,
    alTerminar: async (audio) => {
      try {
        const r = await fetch("/api/ia/voz/dictar", { method: "POST", body: audio });
        const data = await r.json().catch(() => ({}));
        if (!g.sigueVivo()) return;
        if (!r.ok) {
          // El motivo del servidor viene redactado para leerse tal cual: dice
          // con que puede seguir trabajando, no solo que algo fallo.
          g.setError(data.error ?? "No se pudo transcribir.");
          return;
        }
        const dicho = (data.texto ?? "").trim();
        if (!dicho) {
          g.setError("No le entendí. Acérquese el teléfono e intente de nuevo.");
          return;
        }
        onTexto(dicho);
      } catch {
        if (g.sigueVivo()) g.setError("Se perdió la conexión al mandar el audio.");
      }
    },
  });

  if (g.puedeGrabar === false) return null;
  const grabando = g.estado === "grabando";

  /**
   * El boton y sus avisos NO van envueltos en un contenedor propio.
   *
   * Lo estaban, y el contenedor crecia al aparecer el mensaje de error: el
   * boton se recorria de un lado al otro justo despues de que alguien lo
   * acababa de tocar. Se vio en el telefono comparando dos capturas; por
   * codigo no se nota.
   *
   * Los avisos salen como hermanos con `basis-full`, que dentro de una fila
   * que envuelve los manda a su propio renglon sin tocar el ancho del boton.
   */
  return (
    <>
      <button
        type="button"
        onClick={g.alternar}
        disabled={g.puedeGrabar === null || g.estado === "trabajando"}
        aria-label={grabando ? "Detener el dictado" : "Dictar con el micrófono"}
        aria-pressed={grabando}
        className={cn(
          // Alto de sobra para un dedo con guante: esto se usa parado frente
          // a la maquina, no en un escritorio.
          "inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.6875rem] font-medium transition disabled:opacity-40",
          grabando
            ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
            : "border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700",
          className,
        )}
      >
        {g.estado === "trabajando" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Transcribiendo…
          </>
        ) : grabando ? (
          <>
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden /> Listo
            <span className="tabular-nums opacity-70">
              {g.restantes <= 10 ? `${g.restantes} s` : `${g.segundos} s`}
            </span>
          </>
        ) : (
          <>
            <Mic className="h-3.5 w-3.5" aria-hidden /> {etiqueta}
          </>
        )}
      </button>
      {grabando ? (
        <p className="basis-full text-[0.625rem] text-slate-500" role="status">
          Diga qué encontró y qué hizo. Se corta solo al terminar, o toque «Listo».
        </p>
      ) : null}
      {g.error ? (
        <p className="basis-full text-[0.625rem] text-red-600" role="alert">
          {g.error} Escriba el texto.
        </p>
      ) : null}
    </>
  );
}
