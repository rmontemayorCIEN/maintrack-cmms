"use client";

import { useEffect, useRef, useState } from "react";
import { MAXIMO_SEGUNDOS_DICTADO } from "@/lib/dictado";
import { crearDetectorDeSilencio, SILENCIO_COMANDO_MS } from "@/lib/deteccion-voz";
import { porQueNoSePudo } from "@/lib/dictado";

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
 *   antes enciende el indicador de grabacion del telefono sin que nadie haya
 *   tocado nada, y eso asusta con razon.
 *
 *   Se CONSERVA mientras dure la conversacion y se suelta al terminarla o
 *   tras un rato sin usarlo. Las dos formas extremas estuvieron puestas y las
 *   dos fallaron:
 *
 *     Conservandolo mientras la pantalla viviera, el indicador del iPhone se
 *     quedaba encendido para siempre; uno lo tocaba y el sistema ofrecia
 *     «¿dejar de grabar audio?», como si la aplicacion escuchara de fondo.
 *
 *     Soltandolo despues de CADA grabacion —que es lo que se probo despues,
 *     dando por hecho que en HTTPS el permiso quedaba concedido— Safari de
 *     iPhone vuelve a preguntar «¿quiere acceder al microfono?» en cada
 *     frase. Eso es peor: no se puede conversar dando permiso cada vez.
 *
 *   El punto medio es el correcto: se conserva entre una frase y la
 *   siguiente, y se suelta cuando la persona cierra o cuando pasa un rato sin
 *   hablar. El indicador se apaga y nadie da permiso dos veces.
 *
 *   Se graba y se manda al servidor en vez de usar el reconocimiento del
 *   navegador porque Safari de iPhone no lo tiene, y medio piso trae iPhone.
 *   `MediaRecorder` si esta en los dos y el servidor detecta el formato.
 */

export type EstadoGrabacion = "quieto" | "grabando" | "trabajando";



/** Cada cuanto se mide el nivel del microfono. */
const MUESTRA_MS = 100;

/**
 * Cuanto se conserva el microfono sin usarlo antes de soltarlo.
 *
 * Suficiente para encadenar frases sin que vuelvan a pedir permiso, y corto
 * para que el indicador del telefono no se quede encendido si alguien se
 * distrajo o se fue.
 */
const SOLTAR_TRAS_MS = 25_000;

export function usarGrabadora({
  alTerminar,
  silencioMs = SILENCIO_COMANDO_MS,
  cortarSolo = true,
}: {
  alTerminar: (audio: Blob) => Promise<void>;
  /**
   * Cuanto silencio se espera antes de cortar solo.
   *
   * Distinto segun lo que se haga: un comando es corto y urgente, un cierre de
   * orden se dicta a pausas. Ver `lib/deteccion-voz.ts`.
   */
  silencioMs?: number;
  /** En falso, solo corta quien toque el boton. */
  cortarSolo?: boolean;
}) {
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
  /** Lo que escucha el nivel del microfono para saber cuando se dejo de hablar. */
  const escucha = useRef<{ ctx: AudioContext; medidor: ReturnType<typeof setInterval> } | null>(null);
  /** Para soltar el aparato si se deja de usar. */
  const ocioso = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      cerrarEscucha();
      soltarMicrofono();
    };
  }, []);

  /**
   * Suelta lo que mide el nivel.
   *
   * El contexto de audio se cierra SIEMPRE, aunque la grabacion haya acabado
   * por el camino que sea: dejarlo abierto mantiene el microfono tomado y el
   * punto rojo del telefono encendido despues de terminar.
   */
  /**
   * Suelta el microfono. Apaga el indicador del telefono.
   *
   * Se llama al terminar CADA grabacion, no solo al salir de la pantalla.
   */
  function soltarMicrofono() {
    if (ocioso.current) { clearTimeout(ocioso.current); ocioso.current = null; }
    microfono.current?.getTracks().forEach((t) => t.stop());
    microfono.current = null;
  }

  /** Vuelve a contar el rato de gracia antes de soltarlo. */
  function aplazarElSuelte() {
    if (ocioso.current) clearTimeout(ocioso.current);
    ocioso.current = setTimeout(soltarMicrofono, SOLTAR_TRAS_MS);
  }

  function cerrarEscucha() {
    if (!escucha.current) return;
    clearInterval(escucha.current.medidor);
    void escucha.current.ctx.close().catch(() => undefined);
    escucha.current = null;
  }

  /**
   * Escucha el nivel y corta cuando la persona termino de hablar.
   *
   * Si el navegador no tiene audio, simplemente no se corta solo y queda el
   * boton: es una comodidad, no un requisito.
   */
  /**
   * Abre el audio del navegador DENTRO del toque, aunque todavia no haya nada
   * que medir.
   *
   * El contexto nace suspendido y solo se deja reanudar dentro del gesto de
   * la persona. Crearlo despues de `await getUserMedia` ya es tarde: ese await
   * rompe la cadena del gesto, el contexto se queda suspendido, el analizador
   * devuelve ceros, el detector no oye voz nunca y el microfono se queda
   * escuchando para siempre —sin un solo error, porque medir mide; lo que
   * mide es silencio—.
   *
   * El chat de voz ya lo habia aprendido y lo hace igual. Esto no, y se
   * comportaba distinto sin que se viera la causa.
   */
  function abrirAudio(): AudioContext | null {
    try {
      const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Contexto) return null;
      const ctx = new Contexto();
      void ctx.resume().catch(() => undefined);
      return ctx;
    } catch {
      return null;
    }
  }

  function escucharParaCortar(flujo: MediaStream, ctx: AudioContext | null) {
    if (!cortarSolo || !ctx) return;
    try {
      void ctx.resume().catch(() => undefined);
      const fuente = ctx.createMediaStreamSource(flujo);
      const analizador = ctx.createAnalyser();
      analizador.fftSize = 512;
      fuente.connect(analizador);
      const datos = new Float32Array(analizador.fftSize);
      const detector = crearDetectorDeSilencio({ silencioMs, muestraMs: MUESTRA_MS });

      const medidor = setInterval(() => {
        // Si el contexto no llegó a arrancar, el análisis no sirve y hay que
        // decirlo en vez de dejar el micrófono abierto hasta el tope: quien
        // use el botón tendrá que cerrarlo a mano, que es molesto pero
        // honesto. Sin esto, un contexto suspendido se veía como «escuchando»
        // indefinidamente.
        if (ctx.state !== "running") return;
        analizador.getFloatTimeDomainData(datos);
        // Valor eficaz: el volumen de verdad, no el pico. Un golpe seco no
        // cuenta como voz y una voz sostenida no se pierde entre picos.
        let suma = 0;
        for (const v of datos) suma += v * v;
        if (detector.alNivel(Math.sqrt(suma / datos.length)) === "cortar") detener();
      }, MUESTRA_MS);

      escucha.current = { ctx, medidor };
    } catch {
      // Sin medicion se sigue pudiendo grabar; solo hay que tocar el botón.
    }
  }

  function detener() {
    cerrarEscucha();
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
    // Antes que nada, y antes de cualquier espera: el audio solo se abre
    // dentro del gesto.
    const ctxAudio = abrirAudio();
    try {
      /**
       * Primero se le pregunta al navegador si esta aplicacion PUEDE grabar.
       *
       * No es una comprobacion de mas: la aplicacion se estuvo prohibiendo a
       * si misma el microfono durante meses con una cabecera
       * `Permissions-Policy: microphone=()`, y el unico sintoma era un «no se
       * pudo usar el microfono» idéntico al de un permiso denegado. La gente
       * lo fue a buscar a los ajustes del sistema operativo.
       *
       * Preguntando aqui, ese caso se distingue del resto y se dice lo que es.
       */
      const politica = (document as unknown as { featurePolicy?: { allowsFeature: (f: string) => boolean } }).featurePolicy;
      if (politica && !politica.allowsFeature("microphone")) {
        void ctxAudio?.close().catch(() => undefined);
        setError("Esta instalación tiene el micrófono bloqueado por su configuración de seguridad. No es su equipo: hay que corregirlo del lado del servidor.");
        setEstado("quieto");
        return;
      }

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
        // NO se suelta aqui: si se soltara, la frase siguiente volveria a
        // pedir permiso. Se deja en cuenta atras, y si nadie vuelve a hablar
        // se suelta solo.
        aplazarElSuelte();
        if (!audio.size) { if (vivo.current) setEstado("quieto"); return; }
        try {
          await alTerminar(audio);
        } finally {
          if (vivo.current) setEstado("quieto");
        }
      };

      // Mientras se graba no corre la cuenta atras: nadie suelta el aparato
      // en mitad de una frase.
      if (ocioso.current) { clearTimeout(ocioso.current); ocioso.current = null; }
      rec.start();
      escucharParaCortar(microfono.current, ctxAudio);
      setSegundos(0);
      setEstado("grabando");
      reloj.current = setInterval(() => setSegundos((s) => s + 1), 1000);
      // Red de seguridad: el telefono en la bolsa no sube media hora de ruido.
      corte.current = setTimeout(detener, MAXIMO_SEGUNDOS_DICTADO * 1000);
    } catch (e) {
      void ctxAudio?.close().catch(() => undefined);
      setError(porQueNoSePudo(e));
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
    /** Soltar el microfono ya: lo llama quien cierra la conversacion. */
    soltar: soltarMicrofono,
    /** Si esta corta sola o hay que tocar el boton. Para decirlo en pantalla. */
    cortaSolo: cortarSolo,
    /** Para que quien lo use no toque el estado despues de desmontarse. */
    sigueVivo: () => vivo.current,
  };
}
