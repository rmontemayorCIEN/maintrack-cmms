"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [estado, setEstado] = useState<"quieto" | "saludando" | "pensando" | "hablando">("quieto");
  const [error, setError] = useState<string | null>(null);
  const [sinVoz, setSinVoz] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const saludado = useRef(false);

  /** Suena una frase fija del sistema (saludo, acuse). No cuesta casi nada. */
  async function decirFrase(clave: string, pista: HTMLAudioElement) {
    const r = await fetch("/api/ia/voz/frase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave }),
    });
    if (r.status === 204 || !r.ok) { setSinVoz(true); return false; }
    pista.src = URL.createObjectURL(await r.blob());
    await pista.play().catch(() => undefined);
    return true;
  }

  // Al entrar, saluda. Es lo que hace que esto se sienta una conversacion y
  // no un formulario: el sistema habla primero.
  useEffect(() => {
    if (saludado.current) return;
    saludado.current = true;
    const pista = new Audio();
    audio.current = pista;
    setEstado("saludando");
    pista.onended = () => setEstado("quieto");
    pista.onerror = () => setEstado("quieto");
    void decirFrase("saludo", pista).then((sono) => { if (!sono) setEstado("quieto"); });
    return () => { pista.pause(); };
  }, []);

  function callar() {
    if (audio.current) { audio.current.pause(); audio.current = null; }
    setEstado("quieto");
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

      setTurnos((prev) => [{ pregunta: q, respuesta: data.respuesta, consultas: (data.consultas ?? []).length }, ...prev]);

      // Se espera a que el acuse termine de sonar antes de contestar: si no,
      // se encimarian las dos voces.
      await acuse;
      await new Promise<void>((listo) => {
        if (pista.paused || pista.ended) return listo();
        pista.onended = () => listo();
        setTimeout(listo, 4000);
      });
      if (audio.current !== pista) return;

      const voz = await fetch("/api/ia/consulta/voz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: data.respuesta }),
      });
      if (voz.status === 204 || !voz.ok) { setSinVoz(true); setEstado("quieto"); return; }
      setEstado("hablando");
      pista.onended = () => setEstado("quieto");
      pista.src = URL.createObjectURL(await voz.blob());
      await pista.play();
    } catch {
      setError("Se perdió la conexión. Intente de nuevo.");
      setEstado("quieto");
    }
  }

  const ocupado = estado === "pensando" || estado === "hablando" || estado === "saludando";

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-brand-200 bg-brand-50/50 px-4 py-6 text-center">
        <div
          className={cn(
            "mx-auto grid h-16 w-16 place-items-center rounded-full border-2 transition-colors",
            ocupado ? "border-brand-500 bg-brand-100 text-brand-700" : "border-slate-200 bg-white text-slate-400",
          )}
          aria-hidden
        >
          {estado === "pensando" ? <Loader2 className="h-6 w-6 animate-spin" /> : <Mic className="h-6 w-6" />}
        </div>

        <p role="status" className="mt-3 text-sm font-medium text-brand-900">
          {estado === "saludando" ? "Saludando…"
            : estado === "pensando" ? "Revisando sus datos…"
            : estado === "hablando" ? "Contestando…"
            : "Escriba su pregunta y se la contesto hablando"}
        </p>

        {ocupado ? (
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
          placeholder="¿Qué equipo me costó más este trimestre?"
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
          Ahora mismo no se puede generar la voz. Las respuestas siguen aquí escritas.
        </p>
      ) : null}

      {/* Lo dicho tambien se lee. Oyendo no hay forma de comprobar una cifra,
          y quien quiera contrastarla necesita poder verla. */}
      {turnos.map((t, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="mb-1.5 text-sm font-semibold text-slate-800">{t.pregunta}</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{t.respuesta}</p>
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
