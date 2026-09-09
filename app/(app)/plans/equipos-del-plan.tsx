"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarDays, Loader2, Plus, Trash2, Users, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { SelectorMultiple } from "@/components/selector-multiple";
import { cn } from "@/lib/utils";

type Asignacion = {
  id: string;
  nextDueDate: string | null;
  lastCompletedAt: string | null;
  active: boolean;
  asset: { id: string; code: string; name: string; criticality: string };
};

/**
 * A qué equipos se aplica este plan.
 *
 * Diez compresores iguales comparten el plan pero no la fecha: cada uno arranca
 * por separado, que es lo que pasa en la realidad. Por eso el sistema ofrece
 * repartir las fechas en vez de poner la misma a todos.
 */
export function EquiposDelPlan({
  planId,
  nombre,
  intervaloDias,
  porMedidor,
  editable,
  activos,
}: {
  planId: string;
  nombre: string;
  intervaloDias: number | null;
  /** Un plan por medidor no lleva fechas: las calcula la lectura del equipo. */
  porMedidor: boolean;
  editable: boolean;
  activos: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<Asignacion[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [escalonar, setEscalonar] = useState(true);
  const [desde, setDesde] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    const res = await fetch(`/api/plans/asignaciones?planId=${planId}`);
    const c = await res.json().catch(() => null);
    setLista(res.ok ? c.asignaciones : []);
    setCargando(false);
  }
  useEffect(() => { if (abierto) cargar(); }, [abierto]);

  async function agregar() {
    if (!elegidos.length) return;
    setGuardando(true); setError(null);
    const res = await fetch("/api/plans/asignaciones", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, assetIds: elegidos, escalonar, desde: desde || null }),
    });
    setGuardando(false);
    const c = await res.json().catch(() => null);
    if (!res.ok) { setError(c?.error ?? "No se pudo aplicar"); return; }
    if (c?.sinMedidor?.length) {
      setError(
        `Se aplicó, pero ${c.sinMedidor.join(", ")} no tiene medidor. ` +
        "Este plan va por horas de operación, así que ese equipo no va a generar órdenes " +
        "hasta que se le dé de alta su medidor.",
      );
    }
    setElegidos([]); setDesde("");
    cargar(); router.refresh();
  }

  async function quitar(id: string) {
    await fetch("/api/plans/asignaciones", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    cargar(); router.refresh();
  }

  const yaAsignados = new Set((lista ?? []).map((a) => a.asset.id));
  const disponibles = activos.filter((a) => !yaAsignados.has(a.id));
  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(iso)) : "sin fecha";

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[0.625rem] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        title="Equipos a los que se aplica"
      >
        <Users className="h-3 w-3" />
        Equipos
      </button>

      {abierto && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 p-4"
              role="dialog" aria-modal="true"
              onClick={(e) => e.target === e.currentTarget && setAbierto(false)}
            >
              <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Equipos a los que se aplica</h3>
                    <p className="mt-0.5 text-xs text-slate-500">{nombre}</p>
                  </div>
                  <button type="button" onClick={() => setAbierto(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
                    <X className="h-4 w-4" />
                  </button>
                </div>


                {cargando ? (
                  <p className="py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" /></p>
                ) : lista && lista.length > 0 ? (
                  <ul className="mt-4 grid gap-1.5">
                    {lista.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs">
                        <span className="font-medium text-slate-800">{a.asset.code}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-600">{a.asset.name}</span>
                        {a.asset.criticality === "A" ? <Badge tone="danger">Crítico</Badge> : null}
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <CalendarDays className="h-3 w-3" />
                          {porMedidor ? "según su medidor" : fmt(a.nextDueDate)}
                        </span>
                        {editable ? (
                          <button type="button" onClick={() => quitar(a.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                    Este plan todavía no se aplica a ningún equipo.
                  </p>
                )}

                {editable ? (
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aplicar a más equipos</p>

                    <div className="mt-2">
                      <SelectorMultiple
                        valores={elegidos}
                        onCambio={setElegidos}
                        vacio="Elija un equipo"
                        marcador="Busque por clave o nombre del equipo"
                        opciones={disponibles.map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}` }))}
                      />
                    </div>

                    {porMedidor ? (
                      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        Este plan va por <b>horas de operación</b>, no por calendario. Cada equipo vence
                        según su propio medidor, así que no hay fechas que repartir. Si un equipo no
                        tiene medidor dado de alta, no va a generar órdenes.
                      </p>
                    ) : (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs",
                        escalonar && !desde ? "border-brand-400 bg-brand-50/50" : "border-slate-200",
                      )}>
                        <input type="radio" checked={escalonar && !desde} onChange={() => { setEscalonar(true); setDesde(""); }} className="mt-0.5" />
                        <span>
                          <b className="block text-slate-800">Repartir las fechas</b>
                          <span className="text-slate-500">
                            Cada equipo arranca en un día distinto{intervaloDias ? `, a lo largo de los ${intervaloDias} días del ciclo` : ""}.
                            Los críticos primero. Evita parar todo el mismo día.
                          </span>
                        </span>
                      </label>
                      <label className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs",
                        desde ? "border-brand-400 bg-brand-50/50" : "border-slate-200",
                      )}>
                        <input type="radio" checked={!!desde} onChange={() => { setEscalonar(false); setDesde(new Date().toISOString().slice(0, 10)); }} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <b className="block text-slate-800">Todos en la misma fecha</b>
                          <input
                            type="date" className="field mt-1 h-7 py-0 text-xs"
                            value={desde} onChange={(e) => { setDesde(e.target.value); setEscalonar(false); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </span>
                      </label>
                    </div>
                    )}

                    {error ? <p className="mt-2 text-xs text-amber-700">{error}</p> : null}

                    <button type="button" onClick={agregar} disabled={!elegidos.length || guardando} className="btn-primary mt-3">
                      {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Aplicar a {elegidos.length || "…"} equipo(s)
                    </button>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
