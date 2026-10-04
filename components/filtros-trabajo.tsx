"use client";

import { useState } from "react";
import { SelectorBuscable } from "@/components/selector-buscable";
import { MAINTENANCE_TYPE_LABELS } from "@/lib/constants";
import {
  FILTRO_VACIO, SIN_RESPONSABLE, hayFiltro,
  type FiltroTrabajo,
} from "@/lib/filtros-trabajo";

/**
 * Los controles para acotar una lista de trabajo.
 *
 * Son los mismos en el Calendario y en el Tablero, con los mismos nombres y en
 * el mismo orden: quien aprende a filtrar en una pantalla ya sabe filtrar en
 * la otra. Por eso es un componente y no dos bloques parecidos.
 */
export function FiltrosTrabajo({
  valor, alCambiar, tecnicos, activos, familias, extra, extraActivo = false, alLimpiarExtra,
}: {
  valor: FiltroTrabajo;
  alCambiar: (f: FiltroTrabajo) => void;
  tecnicos: { id: string; name: string }[];
  activos: { id: string; code: string; name: string }[];
  familias: { id: string; name: string }[];
  /** Lo que cada pantalla agregue de suyo, al final de la barra. */
  extra?: React.ReactNode;
  /** Si ese filtro propio esta puesto: si no, «Quitar filtros» no aparecería con el solo. */
  extraActivo?: boolean;
  /** Como se apaga ese filtro propio al quitar todos. */
  alLimpiarExtra?: () => void;
}) {
  const [unEquipo, setUnEquipo] = useState("");
  const cambiar = (parche: Partial<FiltroTrabajo>) => alCambiar({ ...valor, ...parche });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="field compacto h-8 min-w-32"
        value={valor.tecnico}
        onChange={(e) => cambiar({ tecnico: e.target.value })}
        aria-label="Filtrar por responsable"
      >
        <option value="">Todo el equipo</option>
        <option value={SIN_RESPONSABLE}>Sin responsable</option>
        {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      <select
        className="field compacto h-8 min-w-32"
        value={valor.tipo}
        onChange={(e) => cambiar({ tipo: e.target.value })}
        aria-label="Filtrar por tipo de mantenimiento"
      >
        <option value="">Todos los tipos</option>
        {Object.entries(MAINTENANCE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>

      {familias.length > 0 ? (
        <select
          className="field compacto h-8 min-w-32"
          value={valor.familia}
          onChange={(e) => alCambiar({ ...valor, familia: e.target.value, equipos: [] })}
          disabled={valor.equipos.length > 0}
          title={valor.equipos.length ? "Quite los equipos elegidos para filtrar por familia" : undefined}
          aria-label="Filtrar por familia de equipo"
        >
          <option value="">Toda la planta</option>
          {familias.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      ) : null}

      <div className="w-44">
        <SelectorBuscable
          className="[&_button]:h-8 [&_button]:py-0 [&_button]:text-xs"
          valor={unEquipo}
          onCambio={(id) => {
            // Elegir un equipo concreto suelta la familia: mandan los equipos.
            if (id && !valor.equipos.includes(id)) {
              alCambiar({ ...valor, equipos: [...valor.equipos, id], familia: "" });
            }
            setUnEquipo("");
          }}
          vacio={valor.equipos.length ? `${valor.equipos.length} equipo(s)` : "Cualquier equipo"}
          marcador="Busque por clave o nombre"
          opciones={activos
            .filter((a) => !valor.equipos.includes(a.id))
            .map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}` }))}
        />
      </div>

      {extra}

      {hayFiltro(valor) || extraActivo ? (
        <button
          type="button"
          onClick={() => { alCambiar(FILTRO_VACIO); alLimpiarExtra?.(); setUnEquipo(""); }}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50"
        >
          Quitar filtros
        </button>
      ) : null}
    </div>
  );
}

/**
 * Los equipos elegidos, para poder quitarlos de uno en uno.
 *
 * Va aparte de la barra porque cada pantalla lo acomoda donde le cabe: el
 * calendario debajo de su encabezado, el tablero encima de las columnas.
 */
export function EquiposElegidos({
  valor, alCambiar, activos,
}: {
  valor: FiltroTrabajo;
  alCambiar: (f: FiltroTrabajo) => void;
  activos: { id: string; code: string; name: string }[];
}) {
  if (!valor.equipos.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {valor.equipos.map((id) => {
        const a = activos.find((x) => x.id === id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => alCambiar({ ...valor, equipos: valor.equipos.filter((x) => x !== id) })}
            className="inline-flex min-h-7 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 text-xs text-brand-800 hover:bg-brand-100"
            title="Quitar este equipo del filtro"
          >
            {a ? a.code : "equipo"} <span aria-hidden="true">×</span>
            <span className="sr-only">Quitar {a ? `${a.code} ${a.name}` : "este equipo"} del filtro</span>
          </button>
        );
      })}
    </div>
  );
}
