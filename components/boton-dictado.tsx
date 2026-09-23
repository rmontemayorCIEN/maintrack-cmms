"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAXIMO_SEGUNDOS_DICTADO } from "@/lib/dictado";

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
 * ── Por que se graba y se manda, y no se usa el navegador ──
 *
 * Chrome trae reconocimiento de voz de balde. Safari de iPhone no, y medio
 * piso trae iPhone. `MediaRecorder` si existe en los dos, y el servidor
 * detecta el formato —Safari manda MP4, Chrome WebM—. Es la misma decision
 * que ya se tomo en el chat con voz, por el mismo motivo.
 *
 * ── Lo que NO hace ──
 *
 * No guarda nada. Devuelve palabras y quien lo usa decide que hacer con
 * ellas. Se puede corregir antes de que se guarde, que es indispensable: la
 * transcripcion se equivoca con los codigos de refaccion y con los nombres
 * propios, y un cierre no se manda a ciegas.
 */

type Estado = "quieto" | "grabando" | "transcribiendo";

export function BotonDictado({
  onTexto,
  etiqueta = "Dictar",
  className,
}: {
  onTexto: (texto: string) => void;
  etiqueta?: string;
  className?: string;
}) {
  const [estado, setEstado] = useState<Estado>("quieto");
  const [error, setError] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  /**
   * Si este navegador puede grabar.
   *
   * Se resuelve DESPUES de montar, no al construir el estado: en el servidor
   * no hay `navigator` y leerlo ahi revienta el render. Arranca en `null`
   * —todavia no se sabe— y el boton no se dibuja hasta saberlo, porque un
   * boton que aparece y desaparece se ve descompuesto.
   */
  const [puedeGrabar, setPuedeGrabar] = useState<boolean | null>(null);

  const grabadora = useRef<MediaRecorder | null>(null);
  const microfono = useRef<MediaStream | null>(null);
  const trozos = useRef<Blob[]>([]);
  const corte = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloj = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Para no tocar el estado de un componente que ya se fue de la pantalla. */
  const vivo = useRef(true);

  useEffect(() => {
    setPuedeGrabar(
      typeof window !== "undefined" &&
        typeof window.MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia),
    );

    return () => {
      vivo.current = false;
      if (corte.current) clearTimeout(corte.current);
      if (reloj.current) clearInterval(reloj.current);
      try {
        if (grabadora.current?.state === "recording") grabadora.current.stop();
      } catch {
        /* ya se habia detenido */
      }
      /**
       * El microfono se suelta al salir, siempre.
       *
       * Dejarlo tomado deja el punto rojo de grabacion encendido en el
       * telefono despues de cerrar el cuadro, y eso asusta —con razon—.
       */
      microfono.current?.getTracks().forEach((t) => t.stop());
      microfono.current = null;
    };
  }, []);

  async function alternar() {
    if (estado === "transcribiendo") return;
    if (estado === "grabando") {
      detener();
      return;
    }

    setError(null);
    try {
      // Se pide una vez y se reusa mientras el cuadro siga abierto: varios
      // navegadores vuelven a preguntar si se suelta entre grabacion y
      // grabacion, y preguntar dos veces seguidas es insoportable.
      if (!microfono.current || !microfono.current.active) {
        microfono.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const rec = new MediaRecorder(microfono.current);
      grabadora.current = rec;
      trozos.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size) trozos.current.push(e.data);
      };
      rec.onstop = async () => {
        const audio = new Blob(trozos.current, { type: rec.mimeType });
        trozos.current = [];
        if (!audio.size) {
          if (vivo.current) setEstado("quieto");
          return;
        }
        await transcribir(audio);
      };

      rec.start();
      setSegundos(0);
      setEstado("grabando");
      reloj.current = setInterval(() => setSegundos((s) => s + 1), 1000);
      // Red de seguridad: el telefono en la bolsa no sube media hora de ruido.
      corte.current = setTimeout(detener, MAXIMO_SEGUNDOS_DICTADO * 1000);
    } catch {
      // Negar el microfono es una decision de la persona, no una falla del
      // sistema: se dice que puede escribir y se sigue.
      setError("No se pudo usar el micrófono. Escriba el texto.");
      setEstado("quieto");
    }
  }

  function detener() {
    if (corte.current) {
      clearTimeout(corte.current);
      corte.current = null;
    }
    if (reloj.current) {
      clearInterval(reloj.current);
      reloj.current = null;
    }
    const rec = grabadora.current;
    grabadora.current = null;
    if (rec && rec.state === "recording") {
      if (vivo.current) setEstado("transcribiendo");
      rec.stop();
    } else if (vivo.current) {
      setEstado("quieto");
    }
  }

  async function transcribir(audio: Blob) {
    if (vivo.current) setEstado("transcribiendo");
    try {
      const r = await fetch("/api/ia/voz/dictar", { method: "POST", body: audio });
      const data = await r.json().catch(() => ({}));
      if (!vivo.current) return;
      if (!r.ok) {
        // El motivo del servidor viene redactado para leerse tal cual: dice
        // con que puede seguir trabajando, no solo que algo fallo.
        setError(data.error ?? "No se pudo transcribir.");
        setEstado("quieto");
        return;
      }
      const dicho = (data.texto ?? "").trim();
      if (!dicho) {
        setError("No le entendí. Acérquese el teléfono e intente de nuevo.");
        setEstado("quieto");
        return;
      }
      onTexto(dicho);
      setEstado("quieto");
    } catch {
      if (!vivo.current) return;
      setError("Se perdió la conexión al mandar el audio.");
      setEstado("quieto");
    }
  }

  if (puedeGrabar === false) return null;

  const grabando = estado === "grabando";
  const restan = MAXIMO_SEGUNDOS_DICTADO - segundos;

  /**
   * El boton y sus avisos NO van envueltos en un contenedor propio.
   *
   * Lo estaban, y el contenedor crecia al aparecer el mensaje de error: el
   * boton se recorria de un lado al otro justo despues de que alguien lo
   * acababa de tocar. Se vio en el telefono comparando dos capturas; por
   * codigo no se nota.
   *
   * Los avisos salen como hermanos del boton con `basis-full`, que dentro de
   * una fila que envuelve los manda a su propio renglon completo sin tocar el
   * ancho del boton. Y si quien lo usa no pone una fila flexible, un parrafo
   * cae debajo igual: funciona en los dos casos.
   */
  return (
    <>
      <button
        type="button"
        onClick={alternar}
        disabled={puedeGrabar === null || estado === "transcribiendo"}
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
        {estado === "transcribiendo" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Transcribiendo…
          </>
        ) : grabando ? (
          <>
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden /> Listo
            <span className="tabular-nums opacity-70">
              {restan <= 10 ? `${restan} s` : `${segundos} s`}
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
          Diga qué encontró y qué hizo. Toque «Listo» al terminar.
        </p>
      ) : null}
      {error ? (
        <p className="basis-full text-[0.625rem] text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
