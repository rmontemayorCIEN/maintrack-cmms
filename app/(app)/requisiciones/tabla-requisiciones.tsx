"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import { ESTADOS, MOTIVOS, URGENCIAS } from "@/lib/requisiciones";
import { formatDate } from "@/lib/utils";

export type FilaRequisicion = {
  id: string; folio: string;
  almacen: string; motivo: string; urgencia: string; estado: string;
  solicitante: string | null;
  orden: string | null; activo: string | null;
  renglones: number; pedido: number; surtido: number; devuelto: number;
  nota: string | null;
  createdAt: string; cerradaEl: string | null;
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");

const TONO_ESTADO: Record<string, "muted" | "info" | "success" | "warning" | "danger"> = {
  SOLICITADA: "warning", PARCIAL: "info", SURTIDA: "success", CERRADA: "muted", CANCELADA: "danger",
};
const TONO_URGENCIA: Record<string, "muted" | "warning" | "danger"> = {
  NORMAL: "muted", ALTA: "warning", PARO: "danger",
};

const FIJAS: Columna<FilaRequisicion>[] = [
  {
    id: "folio", etiqueta: "Folio", texto: (r) => r.folio,
    pinta: (r) => <Link href={`/requisiciones/${r.id}`} className="font-medium text-brand-600 hover:underline">{r.folio}</Link>,
  },
  {
    id: "destino", etiqueta: "Para",
    texto: (r) => `${r.orden ?? ""} ${r.activo ?? ""} ${r.nota ?? ""}`,
    pinta: (r) => (
      <div className="max-w-64">
        <p className="truncate font-medium text-slate-800">{guion(r.orden ?? r.activo)}</p>
        <p className="truncate text-xs text-slate-500">{MOTIVOS[r.motivo as keyof typeof MOTIVOS] ?? r.motivo}</p>
      </div>
    ),
  },
];

const COLUMNAS: Columna<FilaRequisicion>[] = [
  {
    id: "estado", etiqueta: "Estado", agrupable: true,
    texto: (r) => ESTADOS[r.estado as keyof typeof ESTADOS] ?? r.estado,
    pinta: (r) => <Badge tone={TONO_ESTADO[r.estado] ?? "muted"}>{ESTADOS[r.estado as keyof typeof ESTADOS] ?? r.estado}</Badge>,
  },
  {
    id: "urgencia", etiqueta: "Urgencia", agrupable: true,
    texto: (r) => URGENCIAS[r.urgencia as keyof typeof URGENCIAS] ?? r.urgencia,
    pinta: (r) => <Badge tone={TONO_URGENCIA[r.urgencia] ?? "muted"}>{URGENCIAS[r.urgencia as keyof typeof URGENCIAS] ?? r.urgencia}</Badge>,
  },
  { id: "almacen", etiqueta: "Almacen", agrupable: true, texto: (r) => r.almacen },
  { id: "solicitante", etiqueta: "Solicito", agrupable: true, texto: (r) => guion(r.solicitante) },
  { id: "motivo", etiqueta: "Motivo", agrupable: true, texto: (r) => MOTIVOS[r.motivo as keyof typeof MOTIVOS] ?? r.motivo },
  { id: "orden", etiqueta: "Orden de trabajo", agrupable: true, texto: (r) => guion(r.orden) },
  { id: "activo", etiqueta: "Activo", agrupable: true, texto: (r) => guion(r.activo) },
  { id: "renglones", etiqueta: "Renglones", alineaDerecha: true, texto: (r) => String(r.renglones) },
  { id: "pedido", etiqueta: "Pedido", alineaDerecha: true, texto: (r) => String(r.pedido) },
  {
    id: "pendiente", etiqueta: "Por surtir", alineaDerecha: true,
    texto: (r) => String(Math.max(0, r.pedido - r.surtido)),
    pinta: (r) => {
      const falta = Math.max(0, r.pedido - r.surtido);
      if (!falta) return <span className="text-slate-300">—</span>;
      return <span className="font-medium text-amber-700">{falta}</span>;
    },
  },
  { id: "surtido", etiqueta: "Surtido", alineaDerecha: true, texto: (r) => String(r.surtido) },
  {
    id: "devuelto", etiqueta: "Devuelto", alineaDerecha: true,
    texto: (r) => String(r.devuelto),
    pinta: (r) => (r.devuelto ? <span className="text-slate-700">{r.devuelto}</span> : <span className="text-slate-300">—</span>),
  },
  { id: "creada", etiqueta: "Pedida", texto: (r) => formatDate(new Date(r.createdAt)) },
  { id: "cerrada", etiqueta: "Cerrada", texto: (r) => (r.cerradaEl ? formatDate(new Date(r.cerradaEl)) : "—") },
  { id: "nota", etiqueta: "Nota", texto: (r) => guion(r.nota) },
];

/** La vista de fabrica: que falta surtir y que tan urgente es. */
const DE_FABRICA = ["estado", "urgencia", "almacen", "solicitante", "pedido", "pendiente", "creada"];

export function TablaRequisiciones({ requisiciones, vistaInicial }: { requisiciones: FilaRequisicion[]; vistaInicial: Vista }) {
  return (
    <TablaConfigurable
      filas={requisiciones}
      fijas={FIJAS}
      columnas={COLUMNAS}
      deFabrica={DE_FABRICA}
      vistaInicial={vistaInicial}
      clave="requisiciones"
      sustantivo="requisiciones"
      ejemploFiltro='Filtrar: "balero", "paro", "solicitada"…'
    />
  );
}
