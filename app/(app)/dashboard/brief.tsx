"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, Pause, Play, Volume2 } from "lucide-react";
import { pedir } from "@/lib/cliente/pedir";

/**
 * El brief del dia, para escucharlo.
 *
 * ── Dos voces, y la buena primero ──
 *
 * Se pide el audio al servidor, que lo sintetiza con una voz neuronal y lo
 * guarda para no pagarlo dos veces. Si el servidor no puede —sin credenciales
 * en desarrollo, sin señal, o falla la sintesis— contesta 204 y aqui se usa
 * la voz del propio aparato, que suena a maquina pero dice exactamente lo
 * mismo. Quedarse callado porque no se pudo sintetizar seria peor.
 *
 * ── Por que ademas se lee ──
 *
 * Oyendo no se puede verificar nada. Quien quiera contrastar una cifra —o esté
 * donde no puede poner el audio— tiene el mismo texto en pantalla, con sus
 * puntos ligados a donde se ven.
 */

type Punto = { clave: string; texto: string; enlace?: string };
type Datos = {
  texto: string; origen: "ia" | "guion"; saludo: string; fecha: string;
  tranquilo: boolean; puntos: Punto[]; masPuntos: number;
};

/**
 * La mejor voz en espanol que tenga el aparato.
 *
 * Apple instala DOS voces por idioma: la «compact», comprimida, que es la que
 * suena a robot de los noventa, y la mejorada, que suena a persona. Y la
 * compacta suele venir primero en la lista, asi que tomar «la primera que
 * coincida con es-MX» era justo tomar la peor. Aqui se ordenan: primero las
 * que NO son compactas, y dentro de esas las de Mexico.
 *
 * Si el aparato solo trae la compacta se usa esa —es mejor que nada— y la
 * pantalla dice como bajar la buena, porque es gratis y son dos toques.
 */
function vocesEnEspanol(): SpeechSynthesisVoice[] {
  const voces = window.speechSynthesis?.getVoices() ?? [];
  const esComprimida = (v: SpeechSynthesisVoice) => /compact/i.test(v.voiceURI || v.name);
  const puntos = (v: SpeechSynthesisVoice) =>
    (esComprimida(v) ? 0 : 4) + (v.lang === "es-MX" ? 2 : 0) + (v.lang?.startsWith("es") ? 1 : 0);
  return voces.filter((v) => v.lang?.startsWith("es")).sort((a, b) => puntos(b) - puntos(a));
}

function mejorVoz(): SpeechSynthesisVoice | null {
  return vocesEnEspanol()[0] ?? null;
}

/** Si la unica voz disponible es la comprimida, se puede bajar una mejor. */
function soloComprimida(): boolean {
  const voces = vocesEnEspanol();
  return voces.length > 0 && voces.every((v) => /compact/i.test(v.voiceURI || v.name));
}

/**
 * El parte partido en frases, para que se oiga con pausas.
 *
 * Un solo bloque de texto lo lee el motor de corrido, sin respirar: seis
 * renglones seguidos con cifras adentro y nadie retiene nada. Encolando una
 * frase a la vez, el motor hace una pausa natural entre cada una, que es como
 * habla una persona cuando te esta dando el parte.
 */
function enFrases(texto: string): string[] {
  return texto
    .split(/(?<=[.:;])\s+/)
    .map((f) => f.trim())
    .filter(Boolean);
}

export function BriefDelDia() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [hablando, setHablando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hayVoz, setHayVoz] = useState(false);
  const [comprimida, setComprimida] = useState(false);
  /** La voz del aparato quedo como respaldo: se dice, para no parecer un defecto. */
  const [deRespaldo, setDeRespaldo] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const revisar = () => {
      setHayVoz(window.speechSynthesis.getVoices().length > 0);
      setComprimida(soloComprimida());
    };
    revisar();
    // En varios navegadores la lista de voces llega despues de la primera
    // consulta; sin esto el boton diria «sin voz» en la primera carga.
    window.speechSynthesis.addEventListener("voiceschanged", revisar);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", revisar);
      window.speechSynthesis.cancel();
      if (audio.current) audio.current.pause();
    };
  }, []);

  function hablar(texto: string) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const voz = mejorVoz();
    const frases = enFrases(texto);
    setHablando(true);

    frases.forEach((f, i) => {
      const dicha = new SpeechSynthesisUtterance(f);
      if (voz) dicha.voice = voz;
      dicha.lang = voz?.lang ?? "es-MX";
      // Mas lento que lo normal: son cifras, y al volante no hay repetir.
      dicha.rate = 0.92;
      // El saludo un poco mas arriba, como cuando uno empieza a hablar.
      dicha.pitch = i === 0 ? 1.05 : 1;
      if (i === frases.length - 1) {
        dicha.onend = () => setHablando(false);
        dicha.onerror = () => setHablando(false);
      }
      window.speechSynthesis.speak(dicha);
    });
  }

  /**
   * El audio del servidor. Devuelve false cuando no lo hay, para que quien
   * llama caiga a la voz del aparato en vez de dejar a la persona sin parte.
   */
  async function sonarDelServidor(): Promise<boolean> {
    /**
     * El permiso de sonar se toma DENTRO del clic, no al volver del servidor.
     *
     * El navegador solo deja reproducir si el `play()` sale del gesto que lo
     * pidio, y armar el parte tarda unos segundos: al volver, el gesto ya
     * caduco y el `play()` se bloquea sin decir nada. Se veia como «le doy y
     * no suena; le doy otra vez y ahi si». Por eso la pista se crea y se
     * arranca vacia aqui, y cuando llega el audio solo se le cambia la
     * fuente.
     */
    const pista = new Audio();
    pista.onended = () => setHablando(false);
    pista.onerror = () => setHablando(false);
    audio.current = pista;
    void pista.play().catch(() => undefined);

    try {
      const r = await fetch("/api/ia/brief/voz");
      if (r.status === 204 || !r.ok) return false;
      const blob = await r.blob();
      if (!blob.size) return false;
      if (audio.current !== pista) return true; // ya lo detuvieron
      setHablando(true);
      setDeRespaldo(false);
      pista.src = URL.createObjectURL(blob);
      await pista.play();
      return true;
    } catch {
      return false;
    }
  }

  function detener() {
    if (audio.current) {
      audio.current.pause();
      if (audio.current.src.startsWith("blob:")) URL.revokeObjectURL(audio.current.src);
      audio.current = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setHablando(false);
  }

  async function pedirBrief() {
    if (cargando) return;
    setCargando(true);
    setError(null);

    // El texto primero: si la voz falla, la persona al menos lo lee.
    const r = await pedir<Datos>("/api/ia/brief", { method: "GET" });
    if (!r.ok) { setCargando(false); setError(r.error); return; }
    setDatos(r.datos);

    const sono = await sonarDelServidor();
    setCargando(false);
    if (!sono) { setDeRespaldo(true); hablar(r.datos.texto); }
  }

  /**
   * Siempre se vuelve a pedir el parte, tambien al escuchar otra vez.
   *
   * La primera version solo repedia el AUDIO y dejaba en pantalla el texto de
   * la primera consulta: quien corregia una orden y volvia a darle al boton
   * seguia leyendo —y oyendo— la cifra vieja. El parte es de este momento o
   * no sirve; cuando los datos no cambiaron, el servidor reusa lo que ya
   * tenia y no cuesta nada.
   */
  async function alternar() {
    if (hablando) { detener(); return; }
    void pedirBrief();
  }

  return (
    <section aria-labelledby="t-brief" className="mb-4 rounded-xl border border-brand-200 bg-brand-50/50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-brand-700">
            <Volume2 className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="t-brief" className="text-sm font-semibold text-brand-900">El parte del día</h2>
            <p className="text-xs text-brand-800/80">
              {datos ? datos.fecha : "Lo que necesita saber hoy, en menos de un minuto."}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={alternar}
          disabled={cargando}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            : hablando ? <Pause className="h-4 w-4" aria-hidden />
            : <Play className="h-4 w-4" aria-hidden />}
          {cargando ? "Preparando…" : hablando ? "Detener" : datos ? "Escuchar otra vez" : "Escuchar"}
        </button>
      </div>

      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}

      {datos ? (
        <div className="mt-3 border-t border-brand-200/70 pt-3">
          <p className="text-sm leading-relaxed text-slate-800">{datos.texto}</p>

          {datos.puntos.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {datos.puntos.filter((p) => p.enlace).map((p) => (
                <li key={p.clave}>
                  <Link
                    href={p.enlace!}
                    className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-brand-200 bg-white px-2.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
                  >
                    {ETIQUETA[p.clave] ?? "Ver"}<ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          {deRespaldo && comprimida ? (
            <p className="mt-2 text-[0.6875rem] text-slate-500">
              Se está usando la voz de su aparato porque no se pudo generar la del sistema. Suena metálica;
              la mejorada es gratis: Ajustes → Accesibilidad → Contenido hablado → Voces → Español (México).
            </p>
          ) : !hayVoz ? (
            <p className="mt-2 text-[0.6875rem] text-slate-500">
              Este navegador no trae voz instalada: el parte se puede leer, pero no se escucha.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const ETIQUETA: Record<string, string> = {
  detenidos: "Ver equipos parados",
  vencidas: "Ver las vencidas",
  alertas: "Ver alertas",
  compras: "Ver autorizaciones",
  agotadas: "Ver almacén",
  hoy: "Ver el calendario",
};
