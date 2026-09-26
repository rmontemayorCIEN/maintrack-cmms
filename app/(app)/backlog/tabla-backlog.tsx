"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";

/** Un pendiente, ya resuelto para la pantalla. Lo arma el servidor. */
export type FilaPendiente = {
  id: string;
  categoria: string;
  /** Como se llama esa categoria, para agrupar y filtrar por su nombre. */
  categoriaTitulo: string;
  tipo: "ORDEN" | "ACTIVIDAD";
  titulo: string;
  ordenId: string;
  ordenNumero: string;
  origen: string;
  activo: string | null;
  prioridad: string;
  horas: number | null;
  motivo: string;
  nota: string | null;
  responsable: string | null;
  antiguedadDias: number;
  proximaAccion: string;
  avisos: string[];
  yaSePuede: boolean;
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");

/** Urgente antes que baja: por etiqueta se ordenarian alfabeticamente. */
const PESO_PRIORIDAD = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const FIJAS: Columna<FilaPendiente>[] = [
  {
    id: "que", etiqueta: "Qué falta",
    texto: (p) => `${p.ordenNumero} ${p.titulo} ${p.avisos.join(" ")}`,
    pinta: (p) => (
      <div className="max-w-80">
        <Link href={`/work-orders/${p.ordenId}`} className="font-medium text-brand-600 hover:underline">
          {p.tipo === "ORDEN" ? p.ordenNumero : p.titulo}
        </Link>
        {/* En una actividad suelta, la orden de la que salio es el contexto. */}
        {p.tipo === "ORDEN" ? (
          <p className="truncate text-xs text-slate-600">{p.titulo}</p>
        ) : (
          <p className="truncate text-[0.6875rem] text-slate-400">salió de {p.ordenNumero}</p>
        )}
        {p.avisos.length ? <p className="text-[0.6875rem] text-amber-700">{p.avisos.join(" · ")}</p> : null}
      </div>
    ),
  },
];

function crearColumnas(): Columna<FilaPendiente>[] {
  return [
    // Es el eje con que nace agrupada: qué le impide avanzar a cada cosa.
    { id: "categoria", etiqueta: "Por qué está aquí", agrupable: true, texto: (p) => p.categoriaTitulo },
    { id: "origen", etiqueta: "Origen", agrupable: true, texto: (p) => p.origen },
    { id: "activo", etiqueta: "Activo", agrupable: true, texto: (p) => guion(p.activo) },
    {
      id: "prioridad", etiqueta: "Prioridad", agrupable: true,
      texto: (p) => PRIORITY_LABELS[p.prioridad] ?? p.prioridad,
      pinta: (p) => <Badge className={PRIORITY_COLORS[p.prioridad]}>{PRIORITY_LABELS[p.prioridad]}</Badge>,
      ordenPor: (p) => PESO_PRIORIDAD.indexOf(p.prioridad),
    },
    {
      id: "horas", etiqueta: "Horas", alineaDerecha: true,
      texto: (p) => (p.horas === null ? "Sin estimado" : `${formatNumber(p.horas, 1)} h`),
      // Sin estimado va al final al ordenar: no es «cero horas», es que no se sabe.
      ordenPor: (p) => (p.horas === null ? Number.MAX_SAFE_INTEGER : p.horas),
    },
    {
      id: "motivo", etiqueta: "Motivo", agrupable: true, texto: (p) => p.motivo,
      pinta: (p) => (
        <div className="max-w-64">
          <p className="truncate text-slate-700">{p.motivo}</p>
          {p.nota ? <p className="truncate text-xs text-emerald-800">{p.nota}</p> : null}
        </div>
      ),
    },
    {
      id: "responsable", etiqueta: "Responsable", agrupable: true,
      texto: (p) => p.responsable ?? "Sin asignar",
      pinta: (p) => (p.responsable
        ? <span className="text-slate-600">{p.responsable}</span>
        : <span className="text-amber-700">Sin asignar</span>),
    },
    {
      id: "antiguedad", etiqueta: "Antigüedad", alineaDerecha: true,
      texto: (p) => `${p.antiguedadDias} d`,
      ordenPor: (p) => p.antiguedadDias,
    },
    {
      id: "accion", etiqueta: "Próxima acción", texto: (p) => p.proximaAccion,
      pinta: (p) => (
        <div className="max-w-72">
          {p.yaSePuede ? <Badge tone="success">Ya se puede hacer</Badge> : null}
          <p className="text-slate-700">{p.proximaAccion}</p>
        </div>
      ),
    },
  ];
}

/** De entrada: por qué está aquí, de qué equipo, qué tan urgente y qué sigue. */
const DE_FABRICA = ["categoria", "activo", "prioridad", "horas", "responsable", "antiguedad", "accion"];

export function TablaBacklog({
  pendientes, vistaInicial, busquedaInicial,
}: {
  pendientes: FilaPendiente[];
  vistaInicial: Vista;
  busquedaInicial?: string;
}) {
  const columnas = useMemo(() => crearColumnas(), []);
  return (
    <TablaConfigurable
      filas={pendientes}
      fijas={FIJAS}
      columnas={columnas}
      deFabrica={DE_FABRICA}
      /*
       * Nace agrupada por lo que impide avanzar, que es como se leia antes
       * —una tabla por categoria— pero ahora en una sola lista que se puede
       * filtrar, ordenar y reagrupar por otra cosa. Si la persona guardo su
       * vista, manda la suya.
       */
      vistaInicial={{ grupos: ["categoria"], ...vistaInicial }}
      clave="backlog"
      sustantivo="pendientes"
      busquedaInicial={busquedaInicial}
      ejemploFiltro='Filtrar: "refacción", "bomba", "sin asignar"…'
    />
  );
}
