"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Lo que alguien se comprometió a hacer, colgado del registro donde se acordó.
 *
 * ── Qué es y qué no ──
 *
 * No es una lista de tareas. Una orden de trabajo ya es una tarea con
 * responsable, fecha, estado y avance; esto es para lo que NO cabe en una
 * orden —«cotiza el motor con tres proveedores», «habla con seguridad por el
 * permiso»— y por eso es a propósito lo más chico posible: un texto, alguien y
 * una fecha.
 *
 * Si algún día necesita porcentaje de avance, subtareas o dependencias, lo que
 * hacía falta era una orden de trabajo.
 */

type Compromiso = {
  id: string;
  texto: string;
  estado: string;
  paraCuando: string | null;
  responsable: { id: string; name: string } | null;
  creadoPor: { id: string; name: string } | null;
};

type Persona = { id: string; name: string };

const dia = (iso: string, zona: string) =>
  new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: zona });

export function Compromisos({
  entidad, entidadId, yo, zona,
}: {
  /** Como la nombra el sistema al avisar: WorkOrder, Asset, PurchaseRequest… */
  entidad: string;
  entidadId: string;
  yo: string;
  /** La zona de la empresa: una fecha compromiso no puede correrse un día. */
  zona: string;
}) {
  const [lista, setLista] = useState<Compromiso[]>([]);
  const [gente, setGente] = useState<Persona[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [responsableId, setResponsableId] = useState("");
  const [paraCuando, setParaCuando] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function traer() {
    try {
      const r = await fetch(`/api/compromisos?entidad=${entidad}&entidadId=${encodeURIComponent(entidadId)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudieron leer los compromisos."); return; }
      setLista(d.compromisos ?? []); setGente(d.gente ?? []); setError(null);
    } catch {
      setError("Se perdió la conexión.");
    } finally { setCargando(false); }
  }

  useEffect(() => { void traer(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entidad, entidadId]);

  async function anotar() {
    const t = texto.trim();
    if (!t || guardando) return;
    setGuardando(true); setError(null);
    try {
      const r = await fetch("/api/compromisos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entidad, entidadId, texto: t,
          responsableId: responsableId || null,
          paraCuando: paraCuando || null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "No se pudo anotar."); return; }
      setLista(d.compromisos ?? []);
      setTexto(""); setResponsableId(""); setParaCuando(""); setAbierto(false);
    } catch {
      setError("Se perdió la conexión. Su texto sigue aquí.");
    } finally { setGuardando(false); }
  }

  async function cambiar(id: string, estado: string) {
    const r = await fetch(`/api/compromisos/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error ?? "No se pudo cambiar."); return; }
    void traer();
  }

  const abiertos = lista.filter((c) => c.estado === "ABIERTO");

  return (
    <Card>
      <CardHeader
        title="Compromisos"
        subtitle="Lo que se acordó aquí y no es una orden de trabajo: cotizar, hablar con alguien, mandar algo."
        action={
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Anotar
          </button>
        }
      />

      {abierto ? (
        <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <input
            className="field"
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, 300))}
            placeholder="¿Qué quedó de hacer?"
          />
          <div className="flex flex-wrap gap-2">
            <select className="field flex-1" value={responsableId} onChange={(e) => setResponsableId(e.target.value)}>
              <option value="">¿Quién lo hace? (opcional)</option>
              {gente.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input
              type="date" className="field flex-1" value={paraCuando}
              onChange={(e) => setParaCuando(e.target.value)}
              aria-label="Para cuándo"
            />
          </div>
          <button
            type="button"
            onClick={() => void anotar()}
            disabled={guardando || !texto.trim()}
            className="justify-self-start rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : "Anotar compromiso"}
          </button>
        </div>
      ) : null}

      {error ? <p className="mb-2 text-xs text-rose-700">{error}</p> : null}

      {cargando ? (
        <p className="py-3 text-center text-xs text-slate-400">
          <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Cargando…
        </p>
      ) : lista.length === 0 ? (
        <p className="py-3 text-center text-xs text-slate-400">Nada acordado todavía.</p>
      ) : (
        <ul className="grid gap-2">
          {lista.map((c) => {
            const cerrado = c.estado !== "ABIERTO";
            // Puede cerrarlo su responsable Y quien lo anotó: uno porque lo
            // hizo, el otro porque ya no hace falta. Exigir que sea solo uno
            // deja compromisos abiertos esperando a alguien que ya no está en
            // eso.
            const mio = c.responsable?.id === yo || c.creadoPor?.id === yo;
            return (
              <li
                key={c.id}
                className={cn(
                  "flex items-start gap-2 rounded-lg border px-3 py-2",
                  cerrado ? "border-slate-100 bg-slate-50/50" : "border-slate-200",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm leading-snug", cerrado ? "text-slate-400 line-through" : "text-slate-800")}>
                    {c.texto}
                  </p>
                  <p className="mt-0.5 text-[0.625rem] text-slate-500">
                    {c.responsable?.name ?? "sin responsable"}
                    {c.paraCuando ? ` · para el ${dia(c.paraCuando, zona)}` : ""}
                    {c.estado === "HECHO" ? " · hecho" : c.estado === "CANCELADO" ? " · cancelado" : ""}
                  </p>
                </div>
                {mio ? (
                  <div className="flex shrink-0 gap-1">
                    {cerrado ? (
                      <button
                        type="button" onClick={() => void cambiar(c.id, "ABIERTO")}
                        className="rounded px-1.5 py-1 text-[0.625rem] text-slate-500 hover:bg-slate-100"
                      >
                        Reabrir
                      </button>
                    ) : (
                      <>
                        <button
                          type="button" onClick={() => void cambiar(c.id, "HECHO")}
                          aria-label="Marcar hecho" title="Marcar hecho"
                          className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button" onClick={() => void cambiar(c.id, "CANCELADO")}
                          aria-label="Cancelar" title="Ya no hace falta"
                          className="grid h-7 w-7 place-items-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {abiertos.length ? (
        <p className="mt-2 text-[0.625rem] text-slate-400">
          {abiertos.length} {abiertos.length === 1 ? "abierto" : "abiertos"}. Al marcarlo hecho, el aviso de su
          responsable se cierra solo.
        </p>
      ) : null}
    </Card>
  );
}
