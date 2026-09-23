"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check, Copy, Database, Loader2, Sparkles, Square, Volume2 } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { sinMarcas } from "@/lib/utils";
import { ModoVoz } from "./modo-voz";

type Turno = {
  pregunta: string;
  respuesta: string;
  consultas: Array<{ herramienta: string; entrada: Record<string, unknown> }>;
};

const NOMBRE_HERRAMIENTA: Record<string, string> = {
  indicadores: "Indicadores del periodo",
  buscar_ordenes: "Órdenes de trabajo",
  costo_por_activo: "Costo por activo",
  consultar_activo: "Ficha del activo",
  consultar_almacen: "Almacen",
  fallas_frecuentes: "Fallas y causas raiz",
};

/**
 * Consulta en lenguaje natural.
 *
 * Debajo de cada respuesta se muestra que consulto para llegar a ella. Sin eso
 * el usuario tendria que creer en la respuesta a ciegas, y en decisiones de
 * mantenimiento eso no basta.
 */
export function PanelConsulta({
  disponible,
  restantes,
  ejemplos,
  conVoz,
}: {
  disponible: boolean;
  restantes: number;
  ejemplos: string[];
  /** Si esta cuenta tiene el chat con voz (solo Enterprise). */
  conVoz: boolean;
}) {
  /**
   * Escrito o hablado, y se escoge a proposito.
   *
   * Son dos formas distintas de usar lo mismo: escribiendo uno relee, compara
   * y copia; hablando uno va manejando. Meter las dos en una sola pantalla
   * dejaba el audio como un boton perdido que nadie encontraba.
   */
  const [modo, setModo] = useState<"escrito" | "voz">("escrito");
  const [pregunta, setPregunta] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  /** Cual respuesta se esta oyendo. Solo una a la vez. */
  const [sonando, setSonando] = useState<number | null>(null);
  const [copiado, setCopiado] = useState<number | null>(null);
  /** Si se enseñan las sugerencias cuando ya hubo preguntas. */
  const [verEjemplos, setVerEjemplos] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

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

  function callar() {
    if (audio.current) { audio.current.pause(); audio.current = null; }
    setSonando(null);
  }

  /**
   * Oir la respuesta que YA esta en pantalla.
   *
   * No se le vuelve a preguntar al modelo: se manda a decir el mismo texto
   * que el usuario tiene enfrente. Asi lo que oye y lo que lee son lo mismo
   * —si se regenerara, podrian no coincidir— y no se le cobra dos veces la
   * misma respuesta.
   */
  async function escuchar(i: number, texto: string) {
    if (sonando === i) { callar(); return; }
    callar();
    setSonando(i);

    /**
     * El permiso de sonar se pide DENTRO del clic, no despues.
     *
     * El navegador solo deja reproducir audio si el `play()` sale del gesto
     * que lo pidio. Sintetizar tarda unos segundos, asi que al volver del
     * servidor el gesto ya caduco y el `play()` se bloquea en silencio: el
     * icono cambiaba y no se oia nada. Al segundo intento si sonaba —el audio
     * ya estaba guardado y llegaba a tiempo—, y eso hacia ver el defecto como
     * «hay que darle dos veces».
     *
     * Por eso se crea la pista aqui mismo y se arranca vacia: el permiso
     * queda tomado, y cuando llega el audio solo se le cambia la fuente.
     */
    const pista = new Audio();
    pista.onended = () => setSonando(null);
    pista.onerror = () => setSonando(null);
    audio.current = pista;
    void pista.play().catch(() => undefined);

    try {
      const r = await fetch("/api/ia/consulta/voz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto }),
      });
      // 204: no hay voz del sistema. No es un error que valga la pena
      // enseñar; la respuesta sigue ahi para leerse.
      if (r.status === 204 || !r.ok) { callar(); return; }
      if (audio.current !== pista) return; // le dieron a otra mientras tanto
      pista.src = URL.createObjectURL(await r.blob());
      await pista.play();
    } catch {
      callar();
    }
  }

  async function preguntar(texto: string) {
    const q = texto.trim();
    if (q.length < 5) return;
    setCargando(true);
    setError(null);
    const res = await fetch("/api/ia/consulta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pregunta: q }),
    });
    const data = await res.json();
    setCargando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible responder"); return; }
    setTurnos((prev) => [{ pregunta: q, respuesta: data.respuesta, consultas: data.consultas ?? [] }, ...prev]);
    setPregunta("");
  }

  if (disponible && conVoz && modo === "voz") {
    return <ModoVoz ejemplos={ejemplos} onSalir={() => setModo("escrito")} />;
  }

  if (!disponible) {
    return (
      <Card>
        <div className="py-8 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm font-semibold text-slate-800">La consulta con IA no esta activa</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
            Se incluye en el plan Enterprise y en el complemento IA Avanzada.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card>
        {/**
          * Escribir o hablar, uno al lado del otro.
          *
          * El boton de voz estaba al FINAL, debajo de los ejemplos: una fila de
          * sugerencias que ocupa dos o tres renglones lo empujaba fuera de la
          * vista, y ademas cambiaba de sitio —los ejemplos desaparecian tras la
          * primera pregunta y el boton subia de golpe—. Un control que se mueve
          * es un control que no se encuentra.
          *
          * Elegir como preguntar se hace ANTES de preguntar, no despues de leer
          * sugerencias. Por eso van juntos y en un lugar fijo.
          */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="field"
            placeholder="Ej: ¿cuánto llevo gastado en el compresor este año?"
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !cargando) preguntar(pregunta); }}
            maxLength={500}
            disabled={cargando || restantes < 1}
          />
          <div className="flex shrink-0 gap-2">
            {conVoz ? (
              <button
                type="button"
                onClick={() => setModo("voz")}
                disabled={restantes < 1}
                title="Preguntar hablando y escuchar la respuesta"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50/60 px-3 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
              >
                <Volume2 className="h-4 w-4" aria-hidden />
                <span className="sm:hidden">Hablar</span>
                <span className="hidden sm:inline">Hablar y escuchar</span>
              </button>
            ) : null}
            <Button onClick={() => preguntar(pregunta)} disabled={cargando || pregunta.trim().length < 5 || restantes < 1}>
              {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {cargando ? "Consultando…" : "Preguntar"}
            </Button>
          </div>
        </div>

        {restantes < 1 ? (
          <p className="mt-2 text-[0.6875rem] text-amber-700">
            Se agotaron las operaciones de IA de este mes. Se renuevan el dia 1.
          </p>
        ) : (
          /**
           * Las sugerencias siguen estando despues de la primera pregunta.
           *
           * Antes desaparecian para siempre, y quien ya habia preguntado algo
           * se quedaba sin ideas justo cuando empezaba a entender que se le
           * podia pedir. Se recogen en un renglon que se abre, para que no
           * estorben a quien ya sabe que preguntar.
           */
          <div className="mt-3">
            {turnos.length > 0 ? (
              <button
                type="button"
                onClick={() => setVerEjemplos((v) => !v)}
                className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-brand-700 hover:underline"
              >
                {verEjemplos ? "Ocultar ejemplos" : "¿Qué más le puedo preguntar?"}
              </button>
            ) : (
              <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-slate-400">
                Puede preguntar cosas como
              </p>
            )}
            {turnos.length === 0 || verEjemplos ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ejemplos.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => preguntar(e)}
                    disabled={cargando}
                    className="rounded-full border border-slate-200 px-2.5 py-1 text-[0.6875rem] text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
                  >
                    {e}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </Card>

      {turnos.map((t, i) => (
        <Card key={i}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="min-w-0 text-sm font-semibold text-slate-800">{t.pregunta}</p>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void copiar(i, sinMarcas(t.respuesta))}
                title="Copiar la respuesta"
                aria-label="Copiar la respuesta"
                className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[0.6875rem] font-medium text-slate-600 hover:bg-slate-50"
              >
                {copiado === i ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copiado</> : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
              </button>
              <button
                type="button"
                onClick={() => escuchar(i, t.respuesta)}
                title={sonando === i ? "Detener" : "Escuchar la respuesta"}
                aria-label={sonando === i ? "Detener" : "Escuchar la respuesta"}
                className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-brand-700 hover:bg-brand-50"
              >
                {sonando === i ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{sinMarcas(t.respuesta)}</div>
          {t.consultas.length ? (
            <details className="mt-3 border-t border-slate-100 pt-2">
              <summary className="flex cursor-pointer items-center gap-1.5 text-[0.6875rem] text-slate-500 hover:text-slate-700">
                <Database className="h-3 w-3" />
                Consulto {t.consultas.length} {t.consultas.length === 1 ? "fuente" : "fuentes"} de sus datos
              </summary>
              <ul className="mt-1.5 grid gap-1">
                {t.consultas.map((c, j) => (
                  <li key={j} className="text-[0.6875rem] text-slate-500">
                    <span className="font-medium text-slate-600">{NOMBRE_HERRAMIENTA[c.herramienta] ?? c.herramienta}</span>
                    {Object.keys(c.entrada).length ? (
                      <span className="text-slate-400">
                        {" · "}
                        {Object.entries(c.entrada).map(([k, v]) => `${k}: ${String(v)}`).join(", ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
