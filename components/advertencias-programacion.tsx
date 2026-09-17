"use client";

import { AlertTriangle } from "lucide-react";

export type RevisionProgramacion = {
  advertencias: string[];
  diasConCapacidad: Array<{ fecha: string; libres: number }>;
  personasConCapacidad: Array<{ id: string; nombre: string; libres: number }>;
};

const diaCorto = (clave: string) =>
  new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${clave}T12:00:00Z`));

/**
 * Lo que el servidor advirtio al programar, con propuestas de un clic.
 *
 * No es un optimizador: son los dias cercanos en que el responsable tiene
 * lugar y las personas libres ese dia, calculados con la misma carga que
 * pinta el calendario. Quien programa decide si mueve la orden o la deja asi.
 */
export function AdvertenciasProgramacion({
  revision, aceptada, onAceptar, onUsarFecha, onUsarPersona,
}: {
  revision: RevisionProgramacion;
  aceptada: boolean;
  onAceptar: (v: boolean) => void;
  onUsarFecha: (fecha: string) => void;
  onUsarPersona: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" /> Revise la programación
      </p>
      <ul className="mt-1 grid gap-0.5">
        {revision.advertencias.map((a) => <li key={a}>{a}</li>)}
      </ul>
      {revision.diasConCapacidad.length ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1">
          Días con lugar:
          {revision.diasConCapacidad.map((d) => (
            <button key={d.fecha} type="button" onClick={() => onUsarFecha(d.fecha)}
              className="rounded border border-amber-300 bg-white px-1.5 py-0.5 hover:bg-amber-100">
              {diaCorto(d.fecha)} ({d.libres} h libres)
            </button>
          ))}
        </p>
      ) : null}
      {revision.personasConCapacidad.length ? (
        <p className="mt-1 flex flex-wrap items-center gap-1">
          Personas con lugar ese día:
          {revision.personasConCapacidad.map((p) => (
            <button key={p.id} type="button" onClick={() => onUsarPersona(p.id)}
              className="rounded border border-amber-300 bg-white px-1.5 py-0.5 hover:bg-amber-100">
              {p.nombre} ({p.libres} h)
            </button>
          ))}
        </p>
      ) : null}
      <label className="mt-2 flex items-center gap-1.5">
        <input type="checkbox" checked={aceptada} onChange={(e) => onAceptar(e.target.checked)} className="h-3.5 w-3.5" />
        Programar así de todos modos
      </label>
    </div>
  );
}
