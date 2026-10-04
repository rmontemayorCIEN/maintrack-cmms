"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Check, Minus, TriangleAlert } from "lucide-react";
import { useZona } from "@/components/zona-empresa";
import { Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import { PRIORITY_COLORS, PRIORITY_LABELS, WO_STATUS_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { BLOQUES, type ClaveBloque, type EstadoDeBloque, type FilaCierre } from "@/lib/cierre-tipos";

/**
 * Cómo se lee cada casilla del tablero.
 *
 * El color va acompañado de ícono y de texto para el lector de pantalla: un
 * tablero que solo habla con colores deja fuera a quien no los distingue, y
 * aquí son cinco columnas de puro color.
 */
const CASILLA: Record<EstadoDeBloque, { clase: string; etiqueta: string; Icono: typeof Check }> = {
  hecho: { clase: "border-emerald-200 bg-emerald-50 text-emerald-700", etiqueta: "listo", Icono: Check },
  falta: { clase: "border-amber-300 bg-amber-50 text-amber-800", etiqueta: "falta", Icono: TriangleAlert },
  neutro: { clase: "border-slate-200 bg-white text-slate-300", etiqueta: "sin capturar", Icono: Minus },
};

/** Para ordenar: lo que detiene el cierre primero. */
const PESO: Record<EstadoDeBloque, number> = { falta: 0, neutro: 1, hecho: 2 };

function Casilla({ estado, bloque }: { estado: EstadoDeBloque; bloque: string }) {
  const c = CASILLA[estado];
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded border ${c.clase}`}
      title={`${bloque}: ${c.etiqueta}`}
    >
      <c.Icono className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">{bloque}: {c.etiqueta}</span>
    </span>
  );
}

const FIJAS: Columna<FilaCierre>[] = [
  {
    id: "orden", etiqueta: "Orden",
    texto: (f) => `${f.number} ${f.title}`,
    pinta: (f) => (
      <div className="max-w-64">
        <Link href={`/work-orders/${f.id}`} className="font-medium text-brand-600 hover:underline">{f.number}</Link>
        <p className="truncate text-xs text-slate-600">{f.title}</p>
      </div>
    ),
  },
  {
    id: "falta", etiqueta: "Falta", alineaDerecha: true,
    texto: (f) => (f.faltan === 0 ? "Lista para cerrar" : `${f.faltan} pendiente(s)`),
    pinta: (f) => (f.faltan === 0
      ? <Badge tone="success">Lista</Badge>
      : <Badge tone="warning">{f.faltan}</Badge>),
    ordenPor: (f) => f.faltan,
  },
];

function crearColumnas(zona: string): Columna<FilaCierre>[] {
  const deBloques: Columna<FilaCierre>[] = BLOQUES.map((b) => ({
    id: `b-${b.id}`,
    etiqueta: b.texto,
    // El texto es el que se filtra: «falta evidencias» encuentra las que la deben.
    texto: (f) => `${CASILLA[f.bloques[b.id as ClaveBloque]].etiqueta} ${b.texto}`,
    pinta: (f) => <Casilla estado={f.bloques[b.id as ClaveBloque]} bloque={b.texto} />,
    ordenPor: (f) => PESO[f.bloques[b.id as ClaveBloque]],
  }));

  return [
    ...deBloques,
    {
      id: "estado", etiqueta: "Estado", agrupable: true,
      texto: (f) => WO_STATUS_LABELS[f.status] ?? f.status,
    },
    {
      id: "responsable", etiqueta: "Responsable", agrupable: true,
      texto: (f) => f.responsable ?? "Sin asignar",
      pinta: (f) => (f.responsable
        ? <span className="text-slate-600">{f.responsable}</span>
        : <span className="text-amber-700">Sin asignar</span>),
    },
    { id: "activo", etiqueta: "Activo", agrupable: true, texto: (f) => f.activo ?? "—" },
    {
      id: "prioridad", etiqueta: "Prioridad", agrupable: true,
      texto: (f) => PRIORITY_LABELS[f.prioridad] ?? f.prioridad,
      pinta: (f) => <Badge className={PRIORITY_COLORS[f.prioridad]}>{PRIORITY_LABELS[f.prioridad]}</Badge>,
      ordenPor: (f) => ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(f.prioridad),
    },
    {
      id: "esperando", etiqueta: "Esperando", alineaDerecha: true,
      texto: (f) => (f.diasEsperando === null ? "—" : `${f.diasEsperando} d`),
      // Las que no se han completado no llevan esperando: al final, no al principio.
      ordenPor: (f) => (f.diasEsperando === null ? -1 : f.diasEsperando),
    },
    {
      id: "completada", etiqueta: "Completada",
      texto: (f) => (f.completadaEl ? formatDate(new Date(f.completadaEl), zona) : "—"),
      ordenPor: (f) => (f.completadaEl ? new Date(f.completadaEl).getTime() : 0),
    },
    {
      id: "motivos", etiqueta: "Qué falta",
      texto: (f) => f.motivos.join(" · "),
      pinta: (f) => (f.motivos.length ? (
        <ul className="max-w-96 list-disc pl-4 text-xs text-slate-600">
          {f.motivos.map((m, i) => <li key={i} className="truncate" title={m}>{m}</li>)}
        </ul>
      ) : <span className="text-xs text-emerald-700">Nada: se puede cerrar</span>),
    },
  ];
}

/** De entrada: el semáforo, de quién es y cuánto lleva esperando. */
const DE_FABRICA = [
  ...BLOQUES.map((b) => `b-${b.id}`),
  "estado", "responsable", "esperando", "motivos",
];

export function TablaCierre({
  filas, vistaInicial, busquedaInicial,
}: {
  filas: FilaCierre[];
  vistaInicial: Vista;
  busquedaInicial?: string;
}) {
  const zona = useZona();
  const columnas = useMemo(() => crearColumnas(zona), [zona]);
  return (
    <TablaConfigurable
      filas={filas}
      fijas={FIJAS}
      columnas={columnas}
      deFabrica={DE_FABRICA}
      vistaInicial={vistaInicial}
      clave="cierre"
      paso={{ base: "/work-orders", etiqueta: (f) => `${f.number} · ${f.title}` }}
      sustantivo="órdenes"
      busquedaInicial={busquedaInicial}
      ejemploFiltro='Filtrar: "falta evidencias", "lista", "bomba"…'
    />
  );
}
