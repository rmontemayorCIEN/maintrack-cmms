"use client";

import { useEffect, useRef, useState } from "react";
import { MAXIMO_SEGUNDOS_DICTADO } from "@/lib/dictado";

/**
 * Grabar con el microfono: la mecanica, sin la pantalla.
 *
 * La escribio primero el boton de dictado del cierre de orden. Al llegar la
 * navegacion por voz habria sido la segunda copia de lo mismo —permiso del
 * microfono, corte automatico, soltar el aparato al salir— y esas copias son
 * las que se desincronizan: se arregla una y la otra se queda con el defecto.
 *
 * Lo que aqui se decidio una vez, y vale para los dos:
 *
 *   El microfono se pide en el PRIMER toque, no al aparecer el boton. Pedirlo
 *   antes enciende el punto rojo de grabacion del telefono sin que nadie haya
 *   tocado nada, y eso asusta con razon.
 *
 *   Se reusa mientras el componente viva. Soltarlo entre una grabacion y otra
 *   hace que varios navegadores vuelvan a preguntar, y preguntar dos veces
 *   seguidas es insoportable.
 *
 *   Y se suelta SIEMPRE al salir. Dejarlo tomado deja el punto rojo encendido
 *   despues de cerrar la pantalla.
 *
 *   Se graba y se manda al servidor en vez de usar el reconocimiento del
 *   navegador porque Safari de iPhone no lo tiene, y medio piso trae iPhone.
 *   `MediaRecorder` si esta en los dos y el servidor detecta el formato.
 */

export type EstadoGrabacion = "quieto" | "grabando" | "trabajando";

export function usarGrabadora({ alTerminar }: { alTerminar: (audio: Blob) => Promise<void> }) {
  const [estado, setEstado] = useState<EstadoGrabacion>("quieto");
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /**
   * Si este navegador puede grabar.
   *
   * Se resuelve DESPUES de montar: en el servidor no hay `navigator` y leerlo
   * ahi revienta el render. Arranca en `null` —todavia no se sabe— para que
   * quien lo use no dibuje un boton que despues desaparece.
   */
  const [puedeGrabar, setPuedeGrabar] = useState<boolean | null>(null);

  const grabadora = useRef<MediaRecorder | null>(null);
  const microfono = useRef<MediaStream | null>(null);
  const trozos = useRef<Blob[]>([]);
  const corte = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloj = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Para no tocar el estado de algo que ya se fue de la pantalla. */
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
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
      } catch { /* ya se habia detenido */ }
      microfono.current?.getTracks().forEach((t) => t.stop());
      microfono.current = null;
    };
  }, []);

  function detener() {
    if (corte.current) { clearTimeout(corte.current); corte.current = null; }
    if (reloj.current) { clearInterval(reloj.current); reloj.current = null; }
    const rec = grabadora.current;
    grabadora.current = null;
    if (rec && rec.state === "recording") {
      if (vivo.current) setEstado("trabajando");
      rec.stop();
    } else if (vivo.current) {
      setEstado("quieto");
    }
  }

  async function alternar() {
    if (estado === "trabajando") return;
    if (estado === "grabando") { detener(); return; }

    setError(null);
    try {
      if (!microfono.current || !microfono.current.active) {
        microfono.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const rec = new MediaRecorder(microfono.current);
      grabadora.current = rec;
      trozos.current = [];

      rec.ondataavailable = (e) => { if (e.data.size) trozos.current.push(e.data); };
      rec.onstop = async () => {
        const audio = new Blob(trozos.current, { type: rec.mimeType });
        trozos.current = [];
        if (!audio.size) { if (vivo.current) setEstado("quieto"); return; }
        try {
          await alTerminar(audio);
        } finally {
          if (vivo.current) setEstado("quieto");
        }
      };

      rec.start();
      setSegundos(0);
      setEstado("grabando");
      reloj.current = setInterval(() => setSegundos((s) => s + 1), 1000);
      // Red de seguridad: el telefono en la bolsa no sube media hora de ruido.
      corte.current = setTimeout(detener, MAXIMO_SEGUNDOS_DICTADO * 1000);
    } catch {
      // Negar el microfono es una decision de la persona, no una falla.
      setError("No se pudo usar el micrófono.");
      setEstado("quieto");
    }
  }

  return {
    estado,
    segundos,
    restantes: MAXIMO_SEGUNDOS_DICTADO - segundos,
    error,
    setError,
    puedeGrabar,
    alternar,
    detener,
    /** Para que quien lo use no toque el estado despues de desmontarse. */
    sigueVivo: () => vivo.current,
  };
}
