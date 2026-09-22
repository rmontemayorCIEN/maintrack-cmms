"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Mic, Send, Square } from "lucide-react";
import { cn, sinMarcas } from "@/lib/utils";

/**
 * Hablar con el sistema.
 *
 * ── Por que es un modo aparte y no un boton mas ──
 *
 * Un boton de bocina dentro de la pantalla escrita no es «hablar con el
 * sistema»: es leer con audio opcional. Se nota en como lo usa uno —hay que
 * buscar el boton de cada respuesta— y en que nunca se siente una
 * conversacion. Aqui se entra a proposito, el sistema saluda, uno pregunta y
 * el contesta hablando, de corrido.
 *
 * ── El acuse mientras piensa ──
 *
 * Entre la pregunta y la respuesta pasan varios segundos: se consultan los
 * datos y luego se sintetiza. Un silencio de diez segundos se siente como que
 * se descompuso, asi que en cuanto se manda la pregunta se dice «deme un
 * momento». Es texto fijo, cuesta una fraccion y convierte la espera en
 * alguien trabajando.
 *
 * ── Lo que NO hace, a proposito ──
 *
 * No modifica nada. Esto se piensa para usarse en el camino, y dictar el
 * cierre de una orden manejando es capturar mal un dato que despues nadie
 * puede explicar. Preguntar y escuchar, si.
 */

type Turno = { pregunta: string; respuesta: string; consultas: number };

export function ModoVoz({ ejemplos, onSalir }: { ejemplos: string[]; onSalir: () => void }) {
  const [pregunta, setPregunta] = useState("");
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [estado, setEstado] = useState<"quieto" | "saludando" | "grabando" | "oyendo" | "pensando" | "hablando">("quieto");
  const [error, setError] = useState<string | null>(null);
  const [sinVoz, setSinVoz] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const saludado = useRef(false);
  const grabadora = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);
  const latido = useRef<{ parar: () => void } | null>(null);
  /** El contexto de audio, abierto DENTRO del toque para que iOS lo permita. */
  const contexto = useRef<AudioContext | null>(null);
  /**
   * El microfono queda reservado mientras se esta en el modo voz.
   *
   * Antes se soltaba al terminar cada grabacion, y varios navegadores vuelven
   * a preguntar «¿permite usar el microfono?» la siguiente vez: preguntar en
   * cada pregunta es insoportable. Se reserva una vez, se reusa, y se suelta
   * al salir del modo voz —no se queda escuchando cuando uno ya se fue, que
   * seria peor que preguntar de mas—.
   */
  const microfono = useRef<MediaStream | null>(null);
  const [copiado, setCopiado] = useState<number | null>(null);

  /**
   * Un latido bajito mientras revisa los datos.
   *
   * Entre el «dejeme revisar» y la respuesta hay varios segundos de silencio,
   * y un silencio en una conversacion se siente como que se corto la llamada.
   * Un pulso suave cada segundo y medio dice «sigo aqui» sin estorbar.
   *
   * Se genera con el propio navegador —un oscilador— en vez de descargar un
   * archivo: no cuesta, no tarda y no hay nada que se pueda quedar a medias.
   * Va muy bajo y con entrada y salida suaves; un pitido seco, oido en el
   * coche, seria insoportable.
   */
  /**
   * Se abre el audio del navegador en el MISMO toque, aunque todavia no haya
   * nada que sonar.
   *
   * iOS arranca el contexto «suspendido» y solo deja reanudarlo dentro de un
   * gesto de la persona. El latido empieza diez segundos despues —cuando el
   * acuse termina de hablar— y para entonces ya no hay permiso: el contexto
   * se queda suspendido y no se oye nada, sin un solo error. Por eso se abre
   * aqui y luego solo se le programan pulsos.
   */
  function prepararAudio() {
    try {
      if (contexto.current && contexto.current.state !== "closed") {
        void contexto.current.resume().catch(() => undefined);
        return;
      }
      const Contexto = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Contexto) return;
      const ctx = new Contexto();
      void ctx.resume().catch(() => undefined);
      contexto.current = ctx;
    } catch {
      // Sin audio del navegador simplemente no hay latido.
    }
  }

  function empezarLatido() {
    try {
      const ctx = contexto.current;
      if (!ctx || ctx.state === "closed") return;
      void ctx.resume().catch(() => undefined);
      let vivo = true;

      const pulso = () => {
        if (!vivo) return;
        const osc = ctx.createOscillator();
        const vol = ctx.createGain();
        osc.type = "sine";
        // Grave: se oye sin picar el oido, y no compite con la voz.
        osc.frequency.value = 320;
        const t = ctx.currentTime;
        vol.gain.setValueAtTime(0, t);
        // Se oye, pero no manda. Tan bajo que no se notaba no servia de nada.
        vol.gain.linearRampToValueAtTime(0.12, t + 0.05);
        vol.gain.linearRampToValueAtTime(0, t + 0.35);
        osc.connect(vol).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.32);
      };

      pulso();
      const reloj = setInterval(pulso, 1500);
      // El contexto NO se cierra al parar: cerrarlo obliga a pedir permiso
      // otra vez, y la siguiente pregunta se quedaria sin latido.
      latido.current = { parar: () => { vivo = false; clearInterval(reloj); latido.current = null; } };
    } catch {
      // Sin audio del navegador, simplemente no hay latido. No es un fallo.
    }
  }

  function pararLatido() { latido.current?.parar(); }

  /**
   * Suena un audio y AVISA cuando termino, pase lo que pase.
   *
   * Aqui estaba el defecto que dejaba la pantalla en «Contestando…» para
   * siempre: si el navegador bloquea la reproduccion —y lo hace, porque entre
   * la pregunta y la respuesta pasan diez segundos y el permiso del clic ya
   * caduco— nadie volvia a poner el estado en reposo. Ahora la promesa se
   * cierra sola en los cuatro casos: termino, fallo, lo bloquearon, o se
   * paso de largo el tiempo que podia durar.
   */
  function reproducir(blob: Blob, pista: HTMLAudioElement): Promise<boolean> {
    return new Promise((listo) => {
      let cerrado = false;
      const cerrar = (ok: boolean) => { if (!cerrado) { cerrado = true; clearTimeout(reloj); listo(ok); } };
      // Red de seguridad: ningun audio del sistema dura mas de dos minutos.
      const reloj = setTimeout(() => cerrar(false), 120_000);

      pista.onended = () => cerrar(true);
      pista.onerror = () => cerrar(false);
      pista.src = URL.createObjectURL(blob);
      pista.play().catch(() => cerrar(false));
    });
  }

  /** Pide una frase fija del sistema (saludo, acuse) y la suena. */
  async function decirFrase(clave: string, pista: HTMLAudioElement) {
    try {
      const r = await fetch("/api/ia/voz/frase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave }),
      });
      if (r.status === 204 || !r.ok) { setSinVoz(true); return false; }
      return await reproducir(await r.blob(), pista);
    } catch {
      return false;
    }
  }

  // Al entrar, saluda. Es lo que hace que esto se sienta una conversacion y
  // no un formulario: el sistema habla primero.
  useEffect(() => {
    if (saludado.current) return;
    saludado.current = true;
    const pista = new Audio();
    audio.current = pista;
    setEstado("saludando");
    void decirFrase("saludo", pista).finally(() => setEstado("quieto"));
    return () => {
      pista.pause();
      latido.current?.parar();
      void contexto.current?.close().catch(() => undefined);
      contexto.current = null;
      // Al salir del modo voz se suelta el microfono. Dejarlo tomado seria
      // dejar el indicador de grabacion encendido en el telefono, y eso
      // asusta con razon.
      microfono.current?.getTracks().forEach((t) => t.stop());
      microfono.current = null;
    };
  }, []);

  function callar() {
    if (audio.current) { audio.current.pause(); audio.current = null; }
    pararLatido();
    setEstado("quieto");
  }

  /**
   * Grabar la pregunta.
   *
   * Se graba y se manda al servidor en vez de usar el reconocimiento del
   * navegador porque ese NO existe en Safari de iPhone, que es justo donde
   * esto tiene sentido. `MediaRecorder` si esta en los dos, y el formato lo
   * detecta el servidor.
   *
   * Se corta solo a los treinta segundos: si alguien deja el telefono
   * grabando en la bolsa, no se sube media hora de ruido.
   */
  async function grabar() {
    if (estado === "grabando") { detenerGrabacion(); return; }
    callar();
    prepararAudio(); // tocar el microfono tambien abre el audio
    setError(null);
    try {
      // Se pide UNA vez por sesion del modo voz; despues se reusa el mismo.
      if (!microfono.current || !microfono.current.active) {
        microfono.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const flujo = microfono.current;
      const rec = new MediaRecorder(flujo);
      trozos.current = [];
      grabadora.current = rec;

      rec.ondataavailable = (e) => { if (e.data.size) trozos.current.push(e.data); };
      rec.onstop = async () => {
        // El flujo NO se cierra aqui: cerrarlo obliga a volver a pedir
        // permiso en la siguiente pregunta.
        const audioGrabado = new Blob(trozos.current, { type: rec.mimeType });
        trozos.current = [];
        if (!audioGrabado.size) { setEstado("quieto"); return; }
        await transcribir(audioGrabado);
      };

      rec.start();
      setEstado("grabando");
      setTimeout(() => { if (grabadora.current === rec && rec.state === "recording") detenerGrabacion(); }, 30_000);
    } catch {
      // Negar el microfono es una decision de la persona, no una falla: se
      // dice que puede escribir y ya.
      setError("No se pudo usar el micrófono. Puede escribir su pregunta.");
      setEstado("quieto");
    }
  }

  function detenerGrabacion() {
    const rec = grabadora.current;
    if (rec && rec.state === "recording") { setEstado("oyendo"); rec.stop(); }
    grabadora.current = null;
  }

  /** Lo grabado, a palabras; y con eso se pregunta. */
  async function transcribir(audioGrabado: Blob) {
    setEstado("oyendo");
    try {
      const r = await fetch("/api/ia/voz/escuchar", { method: "POST", body: audioGrabado });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "No se pudo entender el audio"); setEstado("quieto"); return; }
      const dicho = (data.texto ?? "").trim();
      if (dicho.length < 5) {
        // No entender no es una falla del sistema: pasa con ruido de planta.
        setError("No le entendí. Acérquese al teléfono o escriba la pregunta.");
        setEstado("quieto");
        return;
      }
      await preguntar(dicho);
    } catch {
      setError("Se perdió la conexión al mandar el audio.");
      setEstado("quieto");
    }
  }

  async function preguntar(texto: string) {
    const q = texto.trim();
    if (q.length < 5 || estado === "pensando") return;
    setError(null);
    setPregunta("");

    /**
     * La pista se crea y se arranca DENTRO del clic.
     *
     * El navegador solo deja sonar si el `play()` sale del gesto de la
     * persona, y aqui pasan segundos antes de tener audio. Si se creara
     * despues, no sonaria nada y habria que darle dos veces.
     */
    callar();
    prepararAudio(); // el permiso se toma aqui, dentro del gesto
    const pista = new Audio();
    audio.current = pista;
    void pista.play().catch(() => undefined);

    setEstado("pensando");
    // El acuse va primero y no se espera a que termine: mientras se oye, la
    // consulta ya va corriendo.
    const acuse = decirFrase("pensando", pista);

    try {
      const res = await fetch("/api/ia/consulta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pregunta: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No fue posible responder");
        setEstado("quieto");
        return;
      }

      // La respuesta se enseña YA, aunque el audio tarde o no llegue: leerla
      // es lo que no puede fallar.
      setTurnos((prev) => [{ pregunta: q, respuesta: data.respuesta, consultas: (data.consultas ?? []).length }, ...prev]);

      // Se pide la voz mientras el acuse todavia suena: asi la espera de la
      // sintesis se gasta en algo que la persona ya esta oyendo.
      const vozPedida = fetch("/api/ia/consulta/voz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: data.respuesta }),
      });

      // El latido empieza cuando el acuse termina de hablar: es justo el hueco
      // de silencio que confundia.
      await acuse;
      if (audio.current === pista) empezarLatido();

      const voz = await vozPedida;
      pararLatido();
      if (audio.current !== pista) return; // lo detuvieron mientras tanto

      if (voz.status === 204 || !voz.ok) { setSinVoz(true); setEstado("quieto"); return; }
      setEstado("hablando");
      const sono = await reproducir(await voz.blob(), pista);
      // Suene o no, la pantalla vuelve a reposo. Si no sono, se dice: quedarse
      // callado sin explicacion es peor que decir «no se pudo».
      setEstado("quieto");
      if (!sono) setSinVoz(true);
    } catch {
      pararLatido();
      setError("Se perdió la conexión. Intente de nuevo.");
      setEstado("quieto");
    }
  }

  /** Copiar la respuesta, para pegarla en un correo o en una junta. */
  async function copiar(i: number, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(i);
      setTimeout(() => setCopiado((actual) => (actual === i ? null : actual)), 2000);
    } catch {
      setError("Este navegador no dejó copiar. Seleccione el texto a mano.");
    }
  }

  const ocupado = estado !== "quieto";

  /**
   * Si el audio no pudo sonar, se dice una sola vez y se ofrece la salida.
   * El texto siempre esta abajo, asi que nadie se queda sin su respuesta.
   */

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-brand-200 bg-brand-50/50 px-4 py-6 text-center">
        <button
          type="button"
          onClick={() => void grabar()}
          disabled={estado === "oyendo" || estado === "pensando"}
          aria-label={estado === "grabando" ? "Dejar de grabar" : "Preguntar hablando"}
          className={cn(
            "mx-auto grid h-20 w-20 place-items-center rounded-full border-2 transition-colors disabled:opacity-60",
            estado === "grabando" ? "border-red-500 bg-red-50 text-red-600"
              : ocupado ? "border-brand-500 bg-brand-100 text-brand-700"
              : "border-brand-300 bg-white text-brand-700 hover:bg-brand-50",
          )}
        >
          {estado === "grabando" ? <Square className="h-7 w-7" />
            : estado === "oyendo" || estado === "pensando" ? <Loader2 className="h-7 w-7 animate-spin" />
            : <Mic className="h-7 w-7" />}
        </button>

        <p role="status" className="mt-3 text-sm font-medium text-brand-900">
          {estado === "saludando" ? "Saludando…"
            : estado === "grabando" ? "Lo escucho… toque otra vez cuando termine"
            : estado === "oyendo" ? "Entendiendo lo que dijo…"
            : estado === "pensando" ? "Revisando sus datos…"
            : estado === "hablando" ? "Contestando…"
            : "Toque el micrófono y pregunte"}
        </p>

        {estado === "hablando" || estado === "saludando" ? (
          <button type="button" onClick={callar} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline">
            <Square className="h-3 w-3" /> Detener
          </button>
        ) : null}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void preguntar(pregunta); }}
        className="flex gap-2"
      >
        <input
          className="field flex-1"
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          placeholder="…o escríbala aquí"
          aria-label="Su pregunta"
          disabled={estado === "pensando"}
        />
        <button
          type="submit"
          disabled={pregunta.trim().length < 5 || estado === "pensando"}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> Preguntar
        </button>
      </form>

      {!turnos.length && ejemplos.length ? (
        <div className="flex flex-wrap gap-1.5">
          {ejemplos.slice(0, 3).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => void preguntar(e)}
              disabled={ocupado}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

      {sinVoz ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          No se pudo reproducir el audio en este aparato. Las respuestas siguen aquí escritas, completas.
        </p>
      ) : null}

      {/* Lo dicho tambien se lee. Oyendo no hay forma de comprobar una cifra,
          y quien quiera contrastarla necesita poder verla. */}
      {turnos.map((t, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <p className="min-w-0 text-sm font-semibold text-slate-800">{t.pregunta}</p>
            <button
              type="button"
              onClick={() => void copiar(i, sinMarcas(t.respuesta))}
              title="Copiar la respuesta"
              aria-label="Copiar la respuesta"
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[0.6875rem] font-medium text-slate-600 hover:bg-slate-50"
            >
              {copiado === i ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copiado</> : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{sinMarcas(t.respuesta)}</p>
          {t.consultas ? (
            <p className="mt-2 border-t border-slate-100 pt-1.5 text-[0.6875rem] text-slate-400">
              Consultó {t.consultas} {t.consultas === 1 ? "fuente" : "fuentes"} de sus datos
            </p>
          ) : null}
        </div>
      ))}

      <button type="button" onClick={() => { callar(); onSalir(); }} className="justify-self-start text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline">
        Volver al modo escrito
      </button>
    </div>
  );
}
