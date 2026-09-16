"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, Loader2, Plus, Trash2, Users, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { SelectorMultiple } from "@/components/selector-multiple";
import { cn, formatDia } from "@/lib/utils";
import { FechasDelEquipo } from "./fechas-del-equipo";

type Asignacion = {
  id: string;
  nextDueDate: string | null;
  lastCompletedAt: string | null;
  active: boolean;
  meterId: string | null;
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
  /** Si `desde` es "la ultima vez que se hizo" o "cuando arranca". */
  const [desdeEsUltima, setDesdeEsUltima] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  /** Las actividades del plan, para dar fechas distintas al asignar. */
  const [actividades, setActividades] = useState<Array<{ id: string; title: string }>>([]);
  /** Solo las actividades que el usuario cambio respecto a la fecha comun. */
  const [porActividad, setPorActividad] = useState<Record<string, { fecha: string; esUltima: boolean }>>({});
  /** De que equipo se estan viendo las fechas. */
  const [fechasDe, setFechasDe] = useState<string | null>(null);

  /**
   * Si algo cambio mientras el dialogo estuvo abierto.
   *
   * La pagina se refresca al CERRAR, no en cada guardado: `router.refresh()`
   * vuelve a armar la tabla, el renglon se monta de nuevo y el dialogo se
   * cerraba solo a la mitad del trabajo —justo despues de corregir las fechas
   * de un equipo, cuando lo natural es seguir con el siguiente—.
   */
  const [huboCambios, setHuboCambios] = useState(false);
  function cerrar() {
    setAbierto(false);
    setFechasDe(null);
    if (huboCambios) {
      setHuboCambios(false);
      router.refresh();
    }
  }

  async function cargar() {
    // Solo la primera vez se muestra la espera: recargar despues de guardar no
    // debe desmontar el panel que la persona esta usando.
    if (lista === null) setCargando(true);
    const res = await fetch(`/api/plans/asignaciones?planId=${planId}`);
    const c = await res.json().catch(() => null);
    setLista(res.ok ? c.asignaciones : []);
    setActividades(res.ok ? (c.actividades ?? []) : []);
    setCargando(false);
  }
  useEffect(() => { if (abierto) cargar(); }, [abierto]);

  async function agregar() {
    if (!elegidos.length) return;
    setGuardando(true); setError(null);
    const res = await fetch("/api/plans/asignaciones", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId, assetIds: elegidos, escalonar,
        desde: desde || null, desdeEsUltima: desde ? desdeEsUltima : false,
        // Solo las que difieren de la fecha comun; las demas la heredan.
        porActividad: desde
          ? Object.entries(porActividad)
              .filter(([, v]) => v.fecha && (v.fecha !== desde || v.esUltima !== desdeEsUltima))
              .map(([planTaskId, v]) => ({ planTaskId, fecha: v.fecha, esUltima: v.esUltima }))
          : [],
      }),
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
    setElegidos([]); setDesde(""); setPorActividad({});
    setHuboCambios(true);
    cargar();
  }

  async function quitar(id: string) {
    await fetch("/api/plans/asignaciones", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setHuboCambios(true);
    cargar();
  }

  const yaAsignados = new Set((lista ?? []).map((a) => a.asset.id));
  const disponibles = activos.filter((a) => !yaAsignados.has(a.id));
  // Dias completos, sin que la zona del navegador los recorra un dia (ver formatDia).
  const fmt = (iso: string | null) => (iso ? formatDia(iso) : "sin fecha");

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
              onClick={(e) => e.target === e.currentTarget && cerrar()}
            >
              <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Equipos a los que se aplica</h3>
                    <p className="mt-0.5 text-xs text-slate-500">{nombre}</p>
                  </div>
                  <button type="button" onClick={cerrar} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
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
                        {porMedidor && !a.meterId ? (
                          <Badge tone="warning">Sin medidor: no genera</Badge>
                        ) : null}
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <CalendarDays className="h-3 w-3" />
                          {porMedidor ? "según su medidor" : fmt(a.nextDueDate)}
                        </span>
                        {/*
                          Las fechas de CADA actividad en este equipo. Al asignar
                          todas nacen con la fecha comun; aqui se corrigen las que
                          en la realidad van distinto, sin quitar el equipo.
                        */}
                        <button
                          type="button"
                          onClick={() => setFechasDe(fechasDe === a.id ? null : a.id)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[0.6875rem] text-slate-600 hover:bg-slate-50"
                          aria-expanded={fechasDe === a.id}
                        >
                          Fechas de sus actividades
                          <ChevronDown className={cn("h-3 w-3 transition-transform", fechasDe === a.id && "rotate-180")} />
                        </button>
                        {editable ? (
                          <button type="button" onClick={() => quitar(a.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {fechasDe === a.id ? (
                          <div className="basis-full border-t border-slate-100 pt-2">
                            <FechasDelEquipo
                              asignacionId={a.id}
                              editable={editable}
                              onGuardado={() => { setHuboCambios(true); cargar(); }}
                            />
                          </div>
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

                    {/*
                      Que SIGNIFICA la fecha.

                      Un plan recien creado no tiene historial, asi que nadie
                      puede deducir cuando se hizo cada actividad por ultima
                      vez: alguien tiene que decirlo una sola vez, y de ahi en
                      adelante manda el historial.

                      Las dos lecturas se ven identicas en pantalla y estan a un
                      intervalo completo de distancia. Sin preguntarlo, la mitad
                      de las altas quedaria corrida un ciclo, en silencio.
                    */}
                    {desde && !porMedidor ? (
                      <div className="mt-2 rounded-lg border border-slate-200 p-2.5">
                        <p className="mb-1.5 text-xs font-medium text-slate-800">
                          Esa fecha es…
                        </p>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          <label className="flex cursor-pointer items-start gap-2 text-xs">
                            <input
                              type="radio" className="mt-0.5"
                              checked={!desdeEsUltima}
                              onChange={() => setDesdeEsUltima(false)}
                            />
                            <span>
                              <b className="block text-slate-700">Cuando arranca</b>
                              <span className="text-slate-500">
                                Ese día toca por primera vez.
                              </span>
                            </span>
                          </label>
                          <label className="flex cursor-pointer items-start gap-2 text-xs">
                            <input
                              type="radio" className="mt-0.5"
                              checked={desdeEsUltima}
                              onChange={() => setDesdeEsUltima(true)}
                            />
                            <span>
                              <b className="block text-slate-700">La última vez que se hizo</b>
                              <span className="text-slate-500">
                                La primera vez cae un intervalo después.
                              </span>
                            </span>
                          </label>
                        </div>
                      </div>
                    ) : null}

                    {/*
                      Fechas distintas por actividad.

                      La fecha comun rara vez es la de todas: el aceite se cambio
                      la semana pasada y la vibracion se midio en agosto. Cada
                      renglon nace con la fecha y el significado comunes, y solo
                      se mandan los que el usuario cambia.
                    */}
                    {desde && !porMedidor && actividades.length > 1 ? (
                      <details className="mt-2 rounded-lg border border-slate-200 p-2.5">
                        <summary className="cursor-pointer text-xs font-medium text-slate-800">
                          Algunas actividades van en otra fecha
                          {Object.keys(porActividad).length ? (
                            <span className="ml-1 font-normal text-slate-500">
                              ({Object.values(porActividad).filter((v) => v.fecha && (v.fecha !== desde || v.esUltima !== desdeEsUltima)).length} distinta(s))
                            </span>
                          ) : null}
                        </summary>
                        <ul className="mt-2 grid gap-1.5">
                          {actividades.map((t) => {
                            const v = porActividad[t.id] ?? { fecha: desde, esUltima: desdeEsUltima };
                            const fijar = (parcial: Partial<{ fecha: string; esUltima: boolean }>) =>
                              setPorActividad((prev) => ({ ...prev, [t.id]: { ...v, ...parcial } }));
                            return (
                              <li key={t.id} className="grid gap-1.5 md:grid-cols-[minmax(0,1fr)_10.5rem_9.5rem] md:items-center">
                                <span className="truncate text-xs text-slate-700">{t.title}</span>
                                <select
                                  className="field"
                                  aria-label={`Qué significa la fecha de ${t.title}`}
                                  value={v.esUltima ? "ULTIMA" : "ARRANCA"}
                                  onChange={(e) => fijar({ esUltima: e.target.value === "ULTIMA" })}
                                >
                                  <option value="ARRANCA">Arranca el</option>
                                  <option value="ULTIMA">La última vez fue</option>
                                </select>
                                <input
                                  type="date"
                                  className="field"
                                  aria-label={`Fecha de ${t.title}`}
                                  value={v.fecha}
                                  onChange={(e) => fijar({ fecha: e.target.value })}
                                />
                              </li>
                            );
                          })}
                        </ul>
                        <p className="mt-1.5 text-[0.6875rem] text-slate-500">
                          Se aplica igual a todos los equipos que eligió. Después se puede corregir
                          equipo por equipo en «Fechas de sus actividades».
                        </p>
                      </details>
                    ) : null}

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
