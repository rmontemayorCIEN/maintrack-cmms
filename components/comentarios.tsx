"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
// De `comentarios-tipos`, NO de `comentarios`: ese importa Prisma, y aquí
// estamos en el navegador.
import { MAXIMO_TEXTO, type Ancla } from "@/lib/comentarios-tipos";
import { cn } from "@/lib/utils";

/**
 * La conversación del registro.
 *
 * ── Qué es y qué no ──
 *
 * No es un chat. Es la bitácora de lo que se habló SOBRE este registro, pegada
 * a él. La diferencia importa: un chat dentro de un CMMS compite con WhatsApp
 * y pierde —nadie deja el grupo donde ya está su cuadrilla—, y usado a medias
 * reproduce la misma dispersión pero ahora también adentro. Lo que sí gana es
 * que la respuesta a «¿esta bomba lleva sello 6205 o 6206?» quede amarrada a
 * la bomba para siempre, en vez de perderse en veinte minutos.
 *
 * ── Uno solo para cuatro pantallas ──
 *
 * Orden, activo, solicitud y requisición. Copiarlo cuatro veces era garantizar
 * que se comportaran distinto: que en una se pudiera borrar y en otra no, que
 * una avisara las menciones y la otra se olvidara.
 */

type Comentario = {
  id: string;
  texto: string;
  createdAt: string;
  editadoEl: string | null;
  eliminadoEl: string | null;
  autor: { id: string; name: string; color: string | null } | null;
  menciones: Array<{ id: string; name: string }>;
};

type Persona = { id: string; name: string };

/**
 * La hora, en la zona de la EMPRESA y no en la del aparato.
 *
 * Lo cazo la suite. Sin `timeZone`, un comentario escrito a las cinco de la
 * tarde en Monterrey se lee a otra hora desde un telefono en otro huso, y en
 * una bitacora de mantenimiento la hora es parte del dato: «lo paramos a las
 * 5» deja de cuadrar con el evento de paro.
 */
const cuando = (iso: string, zona: string) =>
  new Date(iso).toLocaleString("es-MX", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zona,
  });

export function Comentarios({
  ancla, anclaId, yo, zona, titulo = "Conversación",
}: {
  ancla: Ancla;
  anclaId: string;
  /** Quién está viendo: solo puede borrar lo suyo. */
  yo: string;
  /** La zona horaria de la empresa: las horas se leen igual para todos. */
  zona: string;
  titulo?: string;
}) {
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [gente, setGente] = useState<Persona[]>([]);
  const [texto, setTexto] = useState("");
  const [menciones, setMenciones] = useState<Persona[]>([]);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const campo = useRef<HTMLTextAreaElement | null>(null);

  async function traer() {
    try {
      const r = await fetch(`/api/comentarios?ancla=${ancla}&anclaId=${encodeURIComponent(anclaId)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo leer la conversación."); return; }
      setComentarios(d.comentarios ?? []);
      setGente(d.gente ?? []);
      setError(null);
    } catch {
      setError("Se perdió la conexión.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { void traer(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ancla, anclaId]);

  /**
   * Mencionar mete el nombre en el texto Y guarda el identificador.
   *
   * Las dos cosas: el nombre para que se lea, el id para que el servidor sepa
   * a quién avisar. Buscar «@Ana» dentro de la cadena al recibirla funciona
   * hasta que hay dos Anas o alguien se llama «Ana María».
   */
  function mencionar(p: Persona) {
    setEligiendo(false);
    if (!menciones.some((m) => m.id === p.id)) setMenciones((v) => [...v, p]);
    setTexto((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${p.name} `);
    campo.current?.focus();
  }

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true); setError(null);
    try {
      const r = await fetch("/api/comentarios", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Solo se mandan los ids de quien sigue nombrado en el texto: si
        // alguien borró el «@Ana» a medio escribir, no tiene por qué llegarle
        // un aviso.
        body: JSON.stringify({
          ancla, anclaId, texto: t,
          menciones: menciones.filter((m) => t.includes(`@${m.name}`)).map((m) => m.id),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo guardar."); return; }
      setComentarios(d.comentarios ?? []);
      setTexto(""); setMenciones([]);
    } catch {
      setError("Se perdió la conexión. Su texto sigue aquí, vuelva a intentar.");
    } finally {
      setEnviando(false);
    }
  }

  async function borrar(id: string) {
    const r = await fetch(`/api/comentarios/${id}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? "No se pudo borrar."); return; }
    void traer();
  }

  return (
    <Card>
      <CardHeader
        title={titulo}
        subtitle="Lo que se hable aquí queda con este registro. Mencione a alguien con @ y le llega un aviso."
      />

      {cargando ? (
        <p className="py-4 text-center text-xs text-slate-400">
          <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Cargando…
        </p>
      ) : comentarios.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">
          <MessageSquare className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          Todavía no hay nada escrito aquí.
        </p>
      ) : (
        <ul className="mb-3 grid gap-3">
          {comentarios.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <span
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.625rem] font-semibold text-white"
                style={{ background: c.autor?.color ?? "#64748b" }}
                aria-hidden
              >
                {(c.autor?.name ?? "?").slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium text-slate-800">
                    {/* Si la persona ya no está, se dice: el comentario sigue
                        valiendo y perder el hilo entero sería peor. */}
                    {c.autor?.name ?? "Alguien que ya no está"}
                  </span>
                  <span className="text-[0.625rem] text-slate-400">{cuando(c.createdAt, zona)}</span>
                  {c.autor?.id === yo && !c.eliminadoEl ? (
                    <button
                      type="button"
                      onClick={() => void borrar(c.id)}
                      aria-label="Borrar mi comentario"
                      title="Borrar mi comentario"
                      className="ml-auto grid h-6 w-6 place-items-center rounded text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </div>
                {c.eliminadoEl ? (
                  /* Se deja la marca en vez del hueco: una conversación con
                     agujeros no se entiende, y el agujero tapa justo lo que
                     alguien quiso tapar. */
                  <p className="mt-0.5 text-xs italic text-slate-400">Comentario eliminado</p>
                ) : (
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{c.texto}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="mb-2 text-xs text-rose-700">{error}</p> : null}

      <div className="border-t border-slate-100 pt-3">
        <textarea
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, MAXIMO_TEXTO))}
          rows={2}
          placeholder="Escriba lo que haya que dejar anotado aquí…"
          className="field w-full resize-y"
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setEligiendo((v) => !v)}
              disabled={gente.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <AtSign className="h-3.5 w-3.5" aria-hidden /> Mencionar
            </button>
            {eligiendo ? (
              <ul className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {gente.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => mencionar(p)}
                      className={cn(
                        "block w-full px-3 py-1.5 text-left text-xs hover:bg-brand-50",
                        menciones.some((m) => m.id === p.id) ? "text-brand-700" : "text-slate-700",
                      )}
                    >
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {menciones.filter((m) => texto.includes(`@${m.name}`)).map((m) => (
            <span key={m.id} className="rounded-full bg-brand-50 px-2 py-0.5 text-[0.625rem] font-medium text-brand-700">
              avisa a {m.name}
            </span>
          ))}

          <button
            type="button"
            onClick={() => void enviar()}
            disabled={enviando || !texto.trim()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
            Comentar
          </button>
        </div>
      </div>
    </Card>
  );
}
