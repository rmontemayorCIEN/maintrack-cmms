"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import { ESTADOS_COMPRA } from "@/lib/compras";
import { URGENCIAS } from "@/lib/requisiciones";
import { formatCurrency, formatDate } from "@/lib/utils";

export type FilaCompra = {
  id: string; folio: string;
  almacen: string; estado: string; urgencia: string;
  solicitante: string | null; autorizadaPor: string | null;
  proveedorSugerido: string | null;
  requisicion: string | null; requisicionId: string | null;
  ordenCompra: string | null;
  renglones: number; pedido: number; recibido: number;
  montoEstimado: number; justificacion: string | null; motivoRechazo: string | null;
  createdAt: string; autorizadaEl: string | null;
  moneda: string;
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");

const TONO: Record<string, "muted" | "info" | "success" | "warning" | "danger"> = {
  SOLICITADA: "warning", AUTORIZADA: "info", RECHAZADA: "danger", EN_COMPRA: "info",
  RECIBIDA_PARCIAL: "info", RECIBIDA: "success", CERRADA: "muted", CANCELADA: "danger",
};

const FIJAS: Columna<FilaCompra>[] = [
  {
    id: "folio", etiqueta: "Folio", texto: (c) => c.folio,
    pinta: (c) => <Link href={`/compras/${c.id}`} className="font-medium text-brand-600 hover:underline">{c.folio}</Link>,
  },
  {
    id: "que", etiqueta: "Qué se pide",
    texto: (c) => `${c.justificacion ?? ""} ${c.requisicion ?? ""}`,
    pinta: (c) => (
      <div className="max-w-72">
        <p className="truncate font-medium text-slate-800">
          {c.renglones} {c.renglones === 1 ? "renglón" : "renglones"} · {formatCurrency(c.montoEstimado, c.moneda)}
        </p>
        <p className="truncate text-xs text-slate-500">{guion(c.justificacion ?? c.requisicion)}</p>
      </div>
    ),
  },
];

const COLUMNAS: Columna<FilaCompra>[] = [
  {
    id: "estado", etiqueta: "Estado", agrupable: true,
    texto: (c) => ESTADOS_COMPRA[c.estado as keyof typeof ESTADOS_COMPRA] ?? c.estado,
    pinta: (c) => <Badge tone={TONO[c.estado] ?? "muted"}>{ESTADOS_COMPRA[c.estado as keyof typeof ESTADOS_COMPRA] ?? c.estado}</Badge>,
  },
  {
    id: "urgencia", etiqueta: "Urgencia", agrupable: true,
    texto: (c) => URGENCIAS[c.urgencia as keyof typeof URGENCIAS] ?? c.urgencia,
    pinta: (c) => (
      <Badge tone={c.urgencia === "PARO" ? "danger" : c.urgencia === "ALTA" ? "warning" : "muted"}>
        {URGENCIAS[c.urgencia as keyof typeof URGENCIAS] ?? c.urgencia}
      </Badge>
    ),
  },
  { id: "monto", etiqueta: "Monto estimado", alineaDerecha: true, texto: (c) => formatCurrency(c.montoEstimado, c.moneda) },
  { id: "almacen", etiqueta: "Entra a", agrupable: true, texto: (c) => c.almacen },
  { id: "solicitante", etiqueta: "Solicitó", agrupable: true, texto: (c) => guion(c.solicitante) },
  { id: "autorizo", etiqueta: "Autorizó", agrupable: true, texto: (c) => guion(c.autorizadaPor) },
  { id: "proveedor", etiqueta: "Proveedor sugerido", agrupable: true, texto: (c) => guion(c.proveedorSugerido) },
  {
    id: "orden", etiqueta: "Orden de compra", texto: (c) => guion(c.ordenCompra),
    pinta: (c) => c.ordenCompra
      ? <span className="font-mono text-xs text-slate-700">{c.ordenCompra}</span>
      : <span className="text-slate-300">—</span>,
  },
  {
    id: "requisicion", etiqueta: "Nace de", texto: (c) => guion(c.requisicion),
    pinta: (c) => c.requisicionId
      ? <Link href={`/requisiciones/${c.requisicionId}`} className="text-brand-600 hover:underline">{c.requisicion}</Link>
      : <span className="text-slate-300">—</span>,
  },
  { id: "renglones", etiqueta: "Renglones", alineaDerecha: true, texto: (c) => String(c.renglones) },
  { id: "pedido", etiqueta: "Pedido", alineaDerecha: true, texto: (c) => String(c.pedido) },
  {
    id: "porRecibir", etiqueta: "Por recibir", alineaDerecha: true,
    texto: (c) => String(Math.max(0, c.pedido - c.recibido)),
    pinta: (c) => {
      const falta = Math.max(0, c.pedido - c.recibido);
      return falta ? <span className="font-medium text-amber-700">{falta}</span> : <span className="text-slate-300">—</span>;
    },
  },
  { id: "creada", etiqueta: "Pedida", texto: (c) => formatDate(new Date(c.createdAt)) },
  { id: "autorizadaEl", etiqueta: "Autorizada", texto: (c) => (c.autorizadaEl ? formatDate(new Date(c.autorizadaEl)) : "—") },
  { id: "rechazo", etiqueta: "Motivo de rechazo", texto: (c) => guion(c.motivoRechazo) },
];

/** La vista de fabrica: que falta autorizar y que falta llegar. */
const DE_FABRICA = ["estado", "urgencia", "monto", "almacen", "solicitante", "porRecibir", "creada"];

export function TablaCompras({ compras, vistaInicial }: { compras: FilaCompra[]; vistaInicial: Vista }) {
  return (
    <TablaConfigurable
      filas={compras}
      fijas={FIJAS}
      columnas={COLUMNAS}
      deFabrica={DE_FABRICA}
      vistaInicial={vistaInicial}
      clave="compras"
      sustantivo="requisiciones de compra"
      ejemploFiltro='Filtrar: "balero", "paro", "autorizada"…'
    />
  );
}
