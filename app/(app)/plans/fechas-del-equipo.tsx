"use client";

import { useZona } from "@/components/zona-empresa";
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { formatDia } from "@/lib/utils";

type Actividad = {
  planTaskId: string;
  titulo: string;
  frecuencia: string;
  proximaEl: string | null;
  ultimaEl: string | null;
  arranqueEl: string | null;
  arranqueEsUltima: boolean;
  atrasada: boolean;
  bloqueo: string | null;
};

type Respuesta = {
  equipo: string;
  porMedidor: boolean;
  sinMedidor: boolean;
  actividades: Actividad[];
};

/** Lo que el usuario capturo para una actividad, antes de guardar. */
type Cambio = { fecha: string; esUltima: boolean };

// Dias completos, sin que la zona del navegador los recorra un dia (ver formatDia).
const fmt = (iso: string | null, zona?: string) => formatDia(iso, { zona });

/**
 * Las fechas de cada actividad del plan en UN equipo, para verlas y corregirlas.
 *
 * Al asignar un plan todas las actividades nacen con la fecha que se dio en
 * comun, y la realidad casi nunca es asi: la vibracion se midio en agosto, el
 * aceite se cambio la semana pasada. Aqui se dice, actividad por actividad, sin
 * quitar y volver a asignar el equipo.
 *
 * La proxima fecha la calcula el servidor con las reglas de la empresa —dias
 * habiles, meses de calendario—; la pantalla no la adivina.
 */
export function FechasDelEquipo({
  asignacionId,
  editable,
  onGuardado,
}: {
  asignacionId: string;
  editable: boolean;
  onGuardado?: () => void;
}) {
  const zona = useZona();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cambios, setCambios] = useState<Record<string, Cambio>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const res = await fetch(`/api/plans/asignaciones/${asignacionId}/fechas`);
    const c = await res.json().catch(() => null);
    setDatos(res.ok ? c : null);
    if (!res.ok) setError(c?.error ?? "No se pudieron leer las fechas");
    setCargando(false);
  }
  useEffect(() => {
    cargar();
  }, [asignacionId]);

  function cambiar(id: string, parcial: Partial<Cambio>) {
    setAviso(null);
    setCambios((prev) => {
      const actual = prev[id] ?? { fecha: "", esUltima: true };
      return { ...prev, [id]: { ...actual, ...parcial } };
    });
  }

  // Solo cuenta como cambio lo que trae fecha: elegir el significado sin fecha
  // no dice nada.
  const pendientes = Object.entries(cambios).filter(([, c]) => c.fecha);

  async function guardar() {
    if (!pendientes.length) return;
    setGuardando(true);
    setError(null);
    const res = await fetch(`/api/plans/asignaciones/${asignacionId}/fechas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cambios: pendientes.map(([planTaskId, c]) => ({ planTaskId, fecha: c.fecha, esUltima: c.esUltima })),
      }),
    });
    const c = await res.json().catch(() => null);
    setGuardando(false);
    if (!res.ok) {
      setError(c?.error ?? "No se pudieron guardar las fechas");
      return;
    }
    setCambios({});
    setAviso(
      `${c.cambiadas.length === 1 ? "Se corrigió 1 actividad" : `Se corrigieron ${c.cambiadas.length} actividades`}.`,
    );
    await cargar();
    onGuardado?.();
  }

  if (cargando && !datos) {
    return (
      <p className="py-4 text-center">
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" />
      </p>
    );
  }
  if (!datos) return <p className="py-3 text-xs text-amber-700">{error}</p>;

  if (datos.porMedidor) {
    return (
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Este plan va por <b>horas de operación</b>: la fecha de cada equipo la calcula la lectura de
        su medidor, no se captura.
        {datos.sinMedidor ? (
          <b className="mt-1 block text-amber-700">
            Este equipo no tiene medidor asignado, así que no va a generar órdenes hasta que se le
            dé de alta.
          </b>
        ) : null}
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <p className="text-[0.6875rem] leading-relaxed text-slate-500">
        Capture solo las que sean distintas. <b>«La última vez se hizo»</b> cuenta la próxima desde
        esa fecha con las reglas de su empresa; <b>«Toca el»</b> pone esa fecha tal cual. Lo que ya
        va en una orden no se corrige aquí: su fecha se mueve al cerrarla.
      </p>

      <ul className="grid divide-y divide-slate-100 rounded-lg border border-slate-200">
        {datos.actividades.map((a) => {
          const c = cambios[a.planTaskId];
          return (
            <li key={a.planTaskId} className="grid gap-2 px-3 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] md:items-center">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-800">{a.titulo}</p>
                <p className="text-[0.6875rem] text-slate-500">
                  {a.frecuencia}
                  {" · "}última vez {fmt(a.ultimaEl, zona)}
                  {" · "}
                  <span className={a.atrasada ? "font-medium text-rose-600" : ""}>
                    {a.atrasada ? "atrasada, tocaba" : "próxima"} {fmt(a.proximaEl, zona)}
                  </span>
                </p>
              </div>

              {a.bloqueo ? (
                <p className="text-[0.6875rem] text-slate-400 md:text-right">No se corrige: {a.bloqueo}</p>
              ) : editable ? (
                // En el telefono van uno sobre otro: el control nativo de fecha no
                // se encoge a menos de ~150 px, y junto al selector no cabian en el
                // dialogo —el contenido se corria de lado—.
                <div className="grid gap-1.5 sm:flex">
                  <span className="sm:w-[10.5rem] sm:shrink-0">
                    <select
                      className="field"
                      aria-label={`Qué significa la fecha de ${a.titulo}`}
                      value={c?.esUltima === false ? "TOCA" : "ULTIMA"}
                      onChange={(e) => cambiar(a.planTaskId, { esUltima: e.target.value === "ULTIMA" })}
                    >
                      <option value="ULTIMA">La última vez se hizo</option>
                      <option value="TOCA">Toca el</option>
                    </select>
                  </span>
                  <span className="min-w-0 flex-1">
                  <input
                    type="date"
                    className="field"
                    aria-label={`Fecha de ${a.titulo}`}
                    value={c?.fecha ?? ""}
                    onChange={(e) => cambiar(a.planTaskId, { fecha: e.target.value })}
                  />
                  </span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {error ? <p className="text-xs text-amber-700">{error}</p> : null}
      {aviso ? <p className="text-xs text-emerald-700">{aviso}</p> : null}

      {editable ? (
        <div className="flex justify-end">
          <button type="button" onClick={guardar} disabled={!pendientes.length || guardando} className="btn-primary">
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {pendientes.length
              ? `Guardar ${pendientes.length === 1 ? "1 fecha" : `${pendientes.length} fechas`}`
              : "Guardar fechas"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
