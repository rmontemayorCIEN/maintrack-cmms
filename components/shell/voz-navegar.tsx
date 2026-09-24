"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, Square, Volume2, X } from "lucide-react";
import { cn, sinMarcas } from "@/lib/utils";
import { usarGrabadora } from "../usar-grabadora";
import { ESPERA_MAXIMA_MS } from "@/lib/deteccion-voz";
import { crearLatido, pedirFrase, pedirVoz, reproducir } from "../hablar";

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
 * ── Y contesta HABLANDO ──
 *
 * La primera versión de este botón escuchaba y no decía nada: la respuesta
 * aparecía escrita en un cartel. Eso no es hablarle al sistema, es dictarle.
 * Quien trae las manos sucias o va manejando no puede leer un cartel; si hay
 * que leerlo, el micrófono sobraba. Contesta hablando, y solo cuando termina
 * vuelve a escuchar: si el micrófono se abriera mientras el sistema habla, se
 * grabaría a sí mismo.
 *
 * ── Un tono, no un saludo ──
 *
 * Estuvo puesto el saludo hablado del modo voz del chat, y ahí tiene sentido
 * porque se entra a la pantalla una vez. Aquí se toca el botón muchas veces al
 * día y decir «Hola Rafael, en qué le puedo ayudar» en cada una es una espera
 * de dos segundos y medio antes de poder hablar. Rafael: «lo dice cada vez que
 * le doy click».
 *
 * Y escondía algo peor: el saludo terminaba y el micrófono tardaba todavía un
 * segundo en abrir, así que quien arrancaba a hablar al acabar la frase perdía
 * sus primeras palabras. El tono suena cuando la grabación YA empezó, así que
 * no miente, y no cuesta nada.
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
  /** Mientras el sistema habla NO se escucha, o se grabaría a sí mismo. */
  const [hablando, setHablando] = useState(false);
  /** Se dice una sola vez: el aparato no dejó sonar nada. */
  const [sinVoz, setSinVoz] = useState(false);
  const enVano = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  /**
   * Suena algo y avisa al terminar, sin dejar el estado colgado.
   *
   * La pista se compara con la que hay al terminar: si alguien cerró mientras
   * sonaba, ya hay otra —o ninguna— y este resultado no manda.
   */
  async function decir(traer: () => Promise<Blob | null>, alEmpezarASonar?: () => void) {
    const pista = audio.current;
    if (!pista) return;
    setHablando(true);
    try {
      const blob = await traer();
      // El audio ya está aquí: quien acompañaba la espera se calla.
      alEmpezarASonar?.();
      if (audio.current !== pista) return; // lo cerraron mientras tanto
      if (!blob) { setSinVoz(true); return; }
      const sono = await reproducir(blob, pista);
      if (!sono && audio.current === pista) setSinVoz(true);
    } finally {
      // Pase lo que pase se vuelve a escuchar: quedarse mudo y sordo tras un
      // fallo de audio sería peor que no haber hablado.
      if (audio.current === pista) setHablando(false);
    }
  }

  /**
   * Cortar la conversación sin tocar la grabadora.
   *
   * Existe aparte de `cerrar` por orden de declaración: esto lo llama el
   * callback de la grabadora, que se escribe ANTES de que exista `cerrar`.
   * Llamar ahí a `cerrar` compila igual y revienta en ejecución.
   */
  const cortarConversacion = () => {
    setSeguido(false); setHablando(false);
    // Soltar la pista es lo que desarma el acuse y el pulso: los dos se
    // comparan contra ella antes de sonar.
    if (audio.current) { audio.current.pause(); audio.current = null; }
  };

  const g = usarGrabadora({
    // Manos libres reabre el micrófono solo, así que el descuido se repite:
    // si nadie habla se cierra la conversación en vez de subir el silencio.
    esperaMaximaMs: ESPERA_MAXIMA_MS,
    // Un tono corto al abrir el micrófono, en vez del saludo hablado.
    avisarAlEscuchar: true,
    alDesistir: () => cortarConversacion(),
    alTerminar: async (grabado) => {
      /**
       * El silencio empieza AQUÍ, no cuando llega la respuesta.
       *
       * Medido en este proyecto: entre que alguien deja de hablar y que
       * empieza a oír la respuesta pasan más de treinta segundos —oír el
       * audio, consultar los datos, sintetizar la voz—. Sin nada que suene,
       * eso se siente como que se cortó la llamada, y quien va manejando ni
       * siquiera puede mirar la pantalla para comprobar que sigue viva.
       *
       * Dos cosas acompañan esa espera, y se turnan para no encimarse: un
       * pulso suave desde el primer instante, y un «déme un momento» hablado
       * en cuanto el servidor lo manda. Las dos existían en el modo voz del
       * chat; al unificar los micrófonos se quedaron allá.
       */
      const pista = audio.current;
      const pulso = (() => {
        let actual: { parar: () => void } = { parar: () => undefined };
        let acabado = false;
        return {
          latir() {
            if (acabado || audio.current !== pista) return;
            actual.parar();
            actual = crearLatido(g.audioDelNavegador());
          },
          callar() { actual.parar(); actual = { parar: () => undefined }; },
          fin() { acabado = true; actual.parar(); actual = { parar: () => undefined }; },
        };
      })();
      pulso.latir();

      /** «Déme un momento», mientras la consulta corre en paralelo. */
      const acuse = (async () => {
        const blob = await pedirFrase("pensando");
        if (!blob || !pista || audio.current !== pista) return;
        pulso.callar();
        await reproducir(blob, pista);
        // La consulta sigue: vuelve el pulso.
        pulso.latir();
      })().catch(() => undefined);

      /**
       * Esperar al acuse, pero con tope.
       *
       * `reproducir` solo se resuelve cuando el audio TERMINA, y al cerrar la
       * conversación la pista se pausa: una pausa no es un final, así que la
       * promesa se quedaría colgada —hasta su propia red de seguridad de dos
       * minutos— y con ella el botón en «trabajando». La frase dura dos
       * segundos; ocho son de sobra y acotan el peor caso.
       */
      const acuseListo = Promise.race([acuse, new Promise((r) => setTimeout(r, 8000))]);

      try {
        const r = await fetch("/api/ia/navegar", { method: "POST", body: grabado });
        const d = await r.json().catch(() => ({}));
        if (!g.sigueVivo()) return;
        if (!r.ok) { cortarConversacion(); g.soltar(); g.setError(d.error ?? "No se pudo oír en este momento."); return; }


        if (d.tipo === "ir" && d.ruta) {
          /**
           * Al cambiar de pantalla se acaba la conversación: seguir
           * escuchando mientras alguien lee otra cosa sería escuchar de más.
           *
           * Pero el micrófono NO se suelta aquí. Soltándolo, el siguiente
           * toque volvía a pedir permiso —Safari de iPhone pregunta otra vez
           * en cuanto se suelta el aparato—, y encadenar «llévame a…» con una
           * pregunta es justo lo más común. Rafael lo vio: «en un par de
           * ocasiones me salió la ventana de permisos».
           *
           * Queda en la cuenta atrás de siempre: si en veinticinco segundos
           * nadie vuelve a hablar se suelta solo y el indicador del teléfono
           * se apaga. Ese es el mismo trato que entre una frase y la
           * siguiente, no uno nuevo.
           */
          cortarConversacion();
          router.push(d.ruta);
          return;
        }
        if (d.tipo === "respuesta") {
          enVano.current = 0;
          setFallo(null);
          setRespuesta({ texto: d.texto, respuesta: d.respuesta });
          // Que no se encimen las dos voces: primero termina el acuse.
          await acuseListo;
          // Escrita y dicha. La escrita se pone primero porque es la que no
          // puede fallar: de estas cifras se toman decisiones.
          await decir(() => pedirVoz(sinMarcas(d.respuesta)), () => pulso.fin());
          return;
        }
        enVano.current += 1;
        setRespuesta(null);
        setFallo({ mensaje: d.mensaje ?? "No le entendí.", texto: d.texto ?? "", ejemplos: d.ejemplos ?? [] });
        if (enVano.current >= INTENTOS_EN_VANO) setSeguido(false);
      } catch {
        if (g.sigueVivo()) { cortarConversacion(); g.soltar(); g.setError("Se perdió la conexión."); }
      } finally {
        // Pase lo que pase, nada sigue latiendo: un pulso que no para es peor
        // que no haberlo puesto. Al acuse NO se le espera aquí —si alguien
        // cerró, su audio quedó pausado y nunca «termina»—; se le deja morir
        // solo, y `latir` ya no hace nada después de `fin`.
        pulso.fin();
      }
    },
  });

  /**
   * Volver a escuchar cuando se terminó de atender lo anterior.
   *
   * Las tres condiciones son necesarias: que la conversación siga abierta, que
   * la grabadora esté en reposo —no transcribiendo— y que el sistema no esté
   * hablando. Sin la tercera, el micrófono se abriría encima de la respuesta y
   * grabaría la voz del propio sistema.
   */
  useEffect(() => {
    if (!seguido || hablando || g.estado !== "quieto") return;
    const t = setTimeout(() => { if (seguido) void g.alternar(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seguido, hablando, g.estado]);

  /**
   * Si la grabadora falla, se acaba la conversación.
   *
   * Sin esto quedaba marcada como abierta —el botón en «dejar de escuchar»—
   * con nada escuchando detrás: el siguiente toque cerraba algo que ya no
   * existía en vez de volver a empezar, y había que tocar dos veces sin que
   * se entendiera por qué.
   */
  useEffect(() => {
    if (g.error) cortarConversacion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.error]);

  useEffect(() => () => { audio.current?.pause(); audio.current = null; }, []);

  if (g.puedeGrabar === false) return null;

  const grabando = g.estado === "grabando";
  /** Hay conversación abierta: el botón cierra, no abre. */
  const enConversacion = seguido || grabando || hablando || g.estado === "trabajando";

  /**
   * Abrir. Todo lo que iOS solo permite dentro del toque va aquí, antes de
   * cualquier espera: el permiso del audio y el arranque de la pista.
   */
  const abrir = () => {
    enVano.current = 0;
    setFallo(null); setRespuesta(null); setSinVoz(false); g.setError(null);
    g.prepararAudio();
    const pista = new Audio();
    audio.current = pista;
    // Arrancarla vacía dentro del toque es lo que la deja sonar después: la
    // respuesta tarda segundos en llegar del servidor, y para entonces el
    // permiso del clic ya caducó.
    void pista.play().catch(() => undefined);
    // Escucha de inmediato. El tono de la grabadora avisa cuándo empezar.
    setSeguido(true);
  };

  const cerrar = () => {
    cortarConversacion();
    setFallo(null); setRespuesta(null); setSinVoz(false); g.setError(null);
    if (grabando) g.detener();
    // Al cerrar se suelta el micrófono: es lo que apaga el indicador del
    // teléfono. Entre frase y frase NO se suelta, o volvería a pedir permiso.
    g.soltar();
  };

  /** Lo que está pasando, en una línea. Es lo único que se enseña arriba. */
  const paso = hablando ? "Contestando…"
    : grabando ? "Escuchando… diga a dónde ir o pregunte algo"
    : g.estado === "trabajando" ? "Revisando sus datos…"
    : seguido ? "Un momento…"
    : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (enConversacion ? cerrar() : abrir())}
        // Solo se deshabilita mientras no se sabe si el aparato puede grabar.
        // Estuvo apagado durante «trabajando» y eso dejaba a quien quisiera
        // cortar picando un botón muerto: la salida nunca se bloquea.
        disabled={g.puedeGrabar === null}
        aria-label={enConversacion ? "Dejar de escuchar" : "Hablarle al sistema"}
        aria-pressed={enConversacion}
        title="Diga a dónde ir, o pregunte algo"
        className={cn(
          "grid h-10 w-10 place-items-center rounded-lg transition disabled:opacity-40",
          grabando ? "bg-red-50 text-red-600 hover:bg-red-100"
            : enConversacion ? "bg-brand-50 text-brand-700"
            : "text-slate-600 hover:bg-slate-100",
        )}
      >
        {g.estado === "trabajando" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : enConversacion ? (
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
        ) : (
          <Mic className="h-4 w-4" aria-hidden />
        )}
      </button>

      {/* El aviso de estado solo sale cuando NO hay cartel abajo. Los dos
          viven en la misma esquina y encimados no se leía ninguno. */}
      {paso && !respuesta && !fallo && !g.error ? (
        <span
          role="status"
          className="fixed right-3 top-14 z-30 max-w-[calc(100vw-1.5rem)] rounded-md bg-slate-900 px-2 py-1 text-[0.625rem] text-white shadow-lg sm:absolute sm:right-0 sm:top-full sm:mt-1 sm:max-w-none sm:whitespace-nowrap"
        >
          {paso}
          {grabando && g.cortaSolo ? <span className="ml-1 opacity-70">(se corta solo)</span> : null}
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
                {sinMarcas(respuesta.respuesta)}
              </p>
              {paso ? (
                <p className="mt-2 flex items-center gap-1 border-t border-slate-100 pt-2 text-[0.625rem] text-brand-700">
                  <Volume2 className="h-3 w-3" aria-hidden /> {grabando ? "Siga hablando, lo escucho" : paso}
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

          {/* Si el aparato no dejó sonar, se dice: quedarse callado sin
              explicación es lo que hace pensar que se descompuso. */}
          {sinVoz ? (
            <p className="mt-2 border-t border-slate-100 pt-2 text-[0.625rem] text-slate-500">
              Este aparato no dejó reproducir el audio. La respuesta está aquí completa.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
