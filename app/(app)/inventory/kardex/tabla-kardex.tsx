"use client";

import { useZona } from "@/components/zona-empresa";
import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/utils";

export type FilaKardex = {
  id: string;
  fecha: string;
  tipo: string;
  refaccion: string; refaccionCodigo: string; unidad: string;
  almacen: string | null;
  cantidad: number;
  /** Positiva si suma al almacen, negativa si resta. */
  efecto: number;
  saldoDespues: number;
  costoUnitario: number;
  referencia: string | null;
  entregadoA: string | null;
  usuario: string | null;
  documento: { texto: string; href: string } | null;
  moneda: string;
};

export const TIPOS: Record<string, string> = {
  IN: "Entrada",
  OUT: "Salida",
  ADJUST: "Ajuste",
  RETURN: "Devolución",
  TRANSFER_IN: "Traspaso · entra",
  TRANSFER_OUT: "Traspaso · sale",
};

const TONO: Record<string, "success" | "danger" | "info" | "warning" | "muted"> = {
  IN: "success", RETURN: "info", TRANSFER_IN: "success",
  OUT: "danger", TRANSFER_OUT: "danger", ADJUST: "warning",
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");

const crearFijas = (zona: string): Columna<FilaKardex>[] => [
  {
    id: "fecha", etiqueta: "Fecha", texto: (m) => formatDateTime(new Date(m.fecha), zona),
    pinta: (m) => <span className="whitespace-nowrap text-xs text-slate-600">{formatDateTime(new Date(m.fecha), zona)}</span>,
  },
  {
    id: "refaccion", etiqueta: "Refacción",
    texto: (m) => `${m.refaccionCodigo} ${m.refaccion}`,
    pinta: (m) => (
      <div className="max-w-56">
        <p className="truncate font-medium text-slate-800">{m.refaccionCodigo}</p>
        <p className="truncate text-xs text-slate-500">{m.refaccion}</p>
      </div>
    ),
  },
];

/** Las columnas llevan la zona de la empresa: sin ella el servidor (UTC) y el navegador formatean distinto (#418). */
const crearColumnas = (zona: string): Columna<FilaKardex>[] => [
  {
    id: "tipo", etiqueta: "Movimiento", agrupable: true,
    texto: (m) => TIPOS[m.tipo] ?? m.tipo,
    pinta: (m) => <Badge tone={TONO[m.tipo] ?? "muted"}>{TIPOS[m.tipo] ?? m.tipo}</Badge>,
  },
  { id: "almacen", etiqueta: "Almacén", agrupable: true, texto: (m) => guion(m.almacen) },
  {
    id: "entrada", etiqueta: "Entra", alineaDerecha: true,
    texto: (m) => (m.efecto > 0 ? formatNumber(m.cantidad, 2) : "—"),
    pinta: (m) => m.efecto > 0
      ? <span className="font-medium text-emerald-700">{formatNumber(m.cantidad, 2)}</span>
      : <span className="text-slate-300">—</span>,
  },
  {
    id: "salida", etiqueta: "Sale", alineaDerecha: true,
    texto: (m) => (m.efecto < 0 ? formatNumber(m.cantidad, 2) : "—"),
    pinta: (m) => m.efecto < 0
      ? <span className="font-medium text-rose-700">{formatNumber(m.cantidad, 2)}</span>
      : <span className="text-slate-300">—</span>,
  },
  {
    id: "saldo", etiqueta: "Saldo", alineaDerecha: true,
    texto: (m) => formatNumber(m.saldoDespues, 2),
    pinta: (m) => <span className="font-medium text-slate-800">{formatNumber(m.saldoDespues, 2)}</span>,
  },
  { id: "unidad", etiqueta: "Unidad", agrupable: true, texto: (m) => m.unidad },
  { id: "costo", etiqueta: "Costo unit.", alineaDerecha: true, texto: (m) => formatCurrency(m.costoUnitario, m.moneda) },
  {
    id: "importe", etiqueta: "Importe", alineaDerecha: true,
    texto: (m) => formatCurrency(m.cantidad * m.costoUnitario, m.moneda),
  },
  {
    // Sin documento cae al motivo, que responde la misma pregunta: de donde
    // vino ese movimiento. Antes quedaba un guion, y esta columna es la que
    // todos miran —«Referencia» no viene de fabrica—, asi que el motivo no se
    // veia por ningun lado.
    id: "documento", etiqueta: "Documento",
    texto: (m) => m.documento?.texto ?? m.referencia ?? "—",
    pinta: (m) => m.documento
      ? <Link href={m.documento.href} className="text-brand-600 hover:underline">{m.documento.texto}</Link>
      : m.referencia
        ? <span className="text-slate-600">{m.referencia}</span>
        : <span className="text-slate-300">—</span>,
  },
  { id: "referencia", etiqueta: "Referencia", texto: (m) => guion(m.referencia) },
  { id: "entregadoA", etiqueta: "Recibió", agrupable: true, texto: (m) => guion(m.entregadoA) },
  { id: "usuario", etiqueta: "Registró", agrupable: true, texto: (m) => guion(m.usuario) },
];

/** La vista de fabrica: el kardex clásico, entrada-salida-saldo. */
// «Registro» entra de fabrica: una entrada de compra no tiene a quien se le
// entrego, y sin esta columna el movimiento no decia quien lo hizo.
const DE_FABRICA = ["tipo", "almacen", "entrada", "salida", "saldo", "documento", "entregadoA", "usuario"];

export function TablaKardex({ movimientos, vistaInicial }: { movimientos: FilaKardex[]; vistaInicial: Vista }) {
  const zona = useZona();
  const columnas = useMemo(() => crearColumnas(zona), [zona]);
  const fijas = useMemo(() => crearFijas(zona), [zona]);
  return (
    <TablaConfigurable
      filas={movimientos}
      fijas={fijas}
      columnas={columnas}
      deFabrica={DE_FABRICA}
      vistaInicial={vistaInicial}
      clave="kardex"
      sustantivo="movimientos"
      ejemploFiltro='Filtrar: "balero", "traspaso", "Juan"…'
    />
  );
}
