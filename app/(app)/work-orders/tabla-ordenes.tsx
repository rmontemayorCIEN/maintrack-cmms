"use client";

import { useZona } from "@/components/zona-empresa";
import { useMemo } from "react";
import Link from "next/link";
import { Avatar, Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import {
  MAINTENANCE_TYPE_COLORS, MAINTENANCE_TYPE_LABELS, PRIORITY_COLORS, PRIORITY_LABELS,
  WO_STATUS_COLORS, WO_STATUS_LABELS,
} from "@/lib/constants";
import { formatCurrency, formatDate, formatDia, formatNumber } from "@/lib/utils";
import type { EstadoDeVencimiento } from "@/lib/vencimiento";

export type FilaOrden = {
  id: string; number: string; title: string;
  activo: string | null; activoCodigo: string | null;
  sitio: string | null; ubicacion: string | null;
  maintenanceType: string; priority: string; status: string;
  responsable: string | null; responsableColor: string | null;
  creadaPor: string | null; cuadrilla: string | null; plan: string | null;
  modoFalla: string | null; causaRaiz: string | null; paroMinutos: number;
  dueDate: string | null; startedAt: string | null; completedAt: string | null; closedAt: string | null; createdAt: string;
  /** Calculado en el servidor con la zona de la empresa y el ESTADO de la orden. */
  vencimiento: EstadoDeVencimiento;
  estimatedHours: number; actualHours: number;
  laborCost: number; partsCost: number; serviceCost: number; otherCost: number; totalCost: number;
  moneda: string;
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");
const fecha = (v: string | null, zona: string) => (v ? formatDate(new Date(v), zona) : "—");

const FIJAS: Columna<FilaOrden>[] = [
  {
    id: "folio", etiqueta: "Folio", texto: (w) => w.number,
    pinta: (w) => <Link href={`/work-orders/${w.id}`} className="font-medium text-brand-600 hover:underline">{w.number}</Link>,
  },
  {
    id: "descripcion", etiqueta: "Descripción",
    texto: (w) => `${w.title} ${w.activoCodigo ?? ""} ${w.activo ?? ""}`,
    pinta: (w) => (
      <div className="max-w-72">
        <p className="truncate font-medium text-slate-800">{w.title}</p>
        <p className="truncate text-xs text-slate-500">
          {w.activoCodigo ? `${w.activoCodigo} · ${w.activo}` : "Sin activo"}
        </p>
      </div>
    ),
  },
];

/** Las columnas llevan la zona de la empresa: sin ella el servidor (UTC) y el navegador formatean distinto (#418). */
const crearColumnas = (zona: string): Columna<FilaOrden>[] => [
  {
    id: "tipo", etiqueta: "Tipo", agrupable: true,
    texto: (w) => MAINTENANCE_TYPE_LABELS[w.maintenanceType] ?? w.maintenanceType,
    pinta: (w) => <Badge className={MAINTENANCE_TYPE_COLORS[w.maintenanceType]}>{MAINTENANCE_TYPE_LABELS[w.maintenanceType]}</Badge>,
  },
  {
    id: "prioridad", etiqueta: "Prioridad", agrupable: true,
    texto: (w) => PRIORITY_LABELS[w.priority] ?? w.priority,
    pinta: (w) => <Badge className={PRIORITY_COLORS[w.priority]}>{PRIORITY_LABELS[w.priority]}</Badge>,
  },
  {
    id: "estado", etiqueta: "Estado", agrupable: true,
    texto: (w) => WO_STATUS_LABELS[w.status] ?? w.status,
    pinta: (w) => <Badge className={WO_STATUS_COLORS[w.status]}>{WO_STATUS_LABELS[w.status]}</Badge>,
  },
  {
    id: "responsable", etiqueta: "Responsable", agrupable: true,
    texto: (w) => guion(w.responsable),
    pinta: (w) => w.responsable ? (
      <div className="flex items-center gap-2">
        <Avatar name={w.responsable} color={w.responsableColor ?? undefined} />
        <span className="text-xs text-slate-600">{w.responsable}</span>
      </div>
    ) : ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"].includes(w.status)
      // Activa sin responsable es trabajo que nadie tiene en su carga: se marca.
      ? <span className="text-xs font-medium text-amber-700">Sin responsable</span>
      : <span className="text-xs text-slate-400">Sin asignar</span>,
  },
  {
    id: "vencimiento", etiqueta: "Vencimiento",
    texto: (w) => w.vencimiento.texto,
    pinta: (w) => <Badge tone={w.vencimiento.tono}>{w.vencimiento.texto}</Badge>,
  },
  { id: "activo", etiqueta: "Activo", agrupable: true, texto: (w) => guion(w.activo) },
  { id: "sitio", etiqueta: "Sitio", agrupable: true, texto: (w) => guion(w.sitio) },
  { id: "ubicacion", etiqueta: "Ubicación", agrupable: true, texto: (w) => guion(w.ubicacion) },
  { id: "cuadrilla", etiqueta: "Cuadrilla", agrupable: true, texto: (w) => guion(w.cuadrilla) },
  { id: "creadaPor", etiqueta: "Creada por", agrupable: true, texto: (w) => guion(w.creadaPor) },
  { id: "modoFalla", etiqueta: "Modo de falla", agrupable: true, texto: (w) => guion(w.modoFalla) },
  { id: "causaRaiz", etiqueta: "Causa raiz", agrupable: true, texto: (w) => guion(w.causaRaiz) },
  { id: "plan", etiqueta: "Plan de origen", agrupable: true, texto: (w) => guion(w.plan) },
  {
    id: "horas", etiqueta: "Horas real / est.", alineaDerecha: true,
    texto: (w) => `${formatNumber(w.actualHours, 1)} / ${formatNumber(w.estimatedHours, 1)}`,
  },
  { id: "costoMo", etiqueta: "Mano de obra", alineaDerecha: true, texto: (w) => formatCurrency(w.laborCost, w.moneda) },
  { id: "costoRef", etiqueta: "Refacciones", alineaDerecha: true, texto: (w) => formatCurrency(w.partsCost, w.moneda) },
  { id: "costoServ", etiqueta: "Servicios externos", alineaDerecha: true, texto: (w) => formatCurrency(w.serviceCost, w.moneda) },
  { id: "costoOtros", etiqueta: "Otros costos", alineaDerecha: true, texto: (w) => formatCurrency(w.otherCost, w.moneda) },
  { id: "costo", etiqueta: "Costo total", alineaDerecha: true, texto: (w) => formatCurrency(w.totalCost, w.moneda) },
  { id: "creada", etiqueta: "Creada", texto: (w) => fecha(w.createdAt, zona) },
  { id: "iniciada", etiqueta: "Iniciada", texto: (w) => fecha(w.startedAt, zona) },
  { id: "compromiso", etiqueta: "Fecha compromiso", texto: (w) => (w.dueDate ? formatDia(w.dueDate, { zona }) : "—") },
  { id: "cerrada", etiqueta: "Terminada", texto: (w) => fecha(w.completedAt, zona) },
  { id: "cierreAdmin", etiqueta: "Cierre administrativo", texto: (w) => fecha(w.closedAt, zona) },
  { id: "paro", etiqueta: "Paro (min)", alineaDerecha: true, texto: (w) => (w.paroMinutos ? String(w.paroMinutos) : "—") },
];

/** La vista de fabrica: lo que se necesita para repartir el trabajo del dia. */
const DE_FABRICA = ["tipo", "prioridad", "estado", "responsable", "vencimiento", "horas", "costo"];

const COLUMNAS_DE_COSTO = new Set(["costoMo", "costoRef", "costoServ", "costoOtros", "costo"]);

export function TablaOrdenes({ ordenes, vistaInicial, conCostos = true }: {
  ordenes: FilaOrden[]; vistaInicial: Vista;
  /** Sin costos (técnico): las columnas de dinero ni se ofrecen (lib/pantallas.ts verCostos). */
  conCostos?: boolean;
}) {
  const zona = useZona();
  const columnas = useMemo(() => crearColumnas(zona).filter((c) => conCostos || !COLUMNAS_DE_COSTO.has(c.id)), [zona, conCostos]);
  return (
    <TablaConfigurable
      filas={ordenes}
      fijas={FIJAS}
      columnas={columnas}
      deFabrica={conCostos ? DE_FABRICA : DE_FABRICA.filter((c) => !COLUMNAS_DE_COSTO.has(c))}
      vistaInicial={vistaInicial}
      clave="ordenes"
      sustantivo="ordenes"
      ejemploFiltro='Filtrar: "bomba", "correctivo", "vencida"…'
    />
  );
}
