"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import {
  ASSET_STATUS_COLORS, ASSET_STATUS_LABELS, CRITICALITY_COLORS, CRITICALITY_LABELS,
} from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/utils";

export type FilaActivo = {
  id: string; code: string; name: string;
  categoria: string | null; sitio: string | null; ubicacion: string | null; padre: string | null;
  criticality: string; status: string;
  manufacturer: string | null; model: string | null; serialNumber: string | null;
  purchaseCost: number; replacementCost: number; expectedLifeYears: number | null;
  commissionedAt: string | null; warrantyExpiry: string | null;
  otAbiertas: number; planes: number; sensores: number; medidores: number;
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");

const FIJAS: Columna<FilaActivo>[] = [
  {
    id: "code", etiqueta: "Codigo", texto: (a) => a.code,
    pinta: (a) => <Link href={`/assets/${a.id}`} className="font-medium text-brand-600 hover:underline">{a.code}</Link>,
  },
  {
    id: "name", etiqueta: "Activo", texto: (a) => `${a.name} ${a.manufacturer ?? ""} ${a.model ?? ""}`,
    pinta: (a) => (
      <div className="max-w-64">
        <p className="truncate font-medium text-slate-800">{a.name}</p>
        <p className="truncate text-xs text-slate-500">
          {[a.manufacturer, a.model].filter(Boolean).join(" · ") || a.categoria || "—"}
        </p>
      </div>
    ),
  },
];

const COLUMNAS: Columna<FilaActivo>[] = [
  { id: "categoria", etiqueta: "Categoria", agrupable: true, texto: (a) => guion(a.categoria) },
  { id: "sitio", etiqueta: "Sitio", agrupable: true, texto: (a) => guion(a.sitio) },
  { id: "ubicacion", etiqueta: "Ubicacion", agrupable: true, texto: (a) => guion(a.ubicacion) },
  {
    id: "criticidad", etiqueta: "Criticidad", agrupable: true,
    texto: (a) => CRITICALITY_LABELS[a.criticality] ?? a.criticality,
    pinta: (a) => <Badge className={CRITICALITY_COLORS[a.criticality]}>{CRITICALITY_LABELS[a.criticality]}</Badge>,
  },
  {
    id: "estado", etiqueta: "Estado", agrupable: true,
    texto: (a) => ASSET_STATUS_LABELS[a.status] ?? a.status,
    pinta: (a) => <Badge className={ASSET_STATUS_COLORS[a.status]}>{ASSET_STATUS_LABELS[a.status]}</Badge>,
  },
  { id: "fabricante", etiqueta: "Fabricante", agrupable: true, texto: (a) => guion(a.manufacturer) },
  { id: "modelo", etiqueta: "Modelo", texto: (a) => guion(a.model) },
  { id: "serie", etiqueta: "No. de serie", texto: (a) => guion(a.serialNumber) },
  { id: "padre", etiqueta: "Pertenece a", agrupable: true, texto: (a) => guion(a.padre) },
  { id: "otAbiertas", etiqueta: "OT abiertas", alineaDerecha: true, texto: (a) => String(a.otAbiertas) },
  { id: "planes", etiqueta: "Planes", alineaDerecha: true, texto: (a) => String(a.planes) },
  { id: "medidores", etiqueta: "Medidores", alineaDerecha: true, texto: (a) => String(a.medidores) },
  { id: "sensores", etiqueta: "Sensores", alineaDerecha: true, texto: (a) => String(a.sensores) },
  {
    id: "garantia", etiqueta: "Garantia",
    texto: (a) => (a.warrantyExpiry ? (new Date(a.warrantyExpiry) > new Date() ? "Vigente" : "Vencida") : "—"),
    pinta: (a) =>
      a.warrantyExpiry
        ? new Date(a.warrantyExpiry) > new Date()
          ? <Badge tone="success">Vigente {formatDate(new Date(a.warrantyExpiry))}</Badge>
          : <span className="text-slate-400">Vencida</span>
        : "—",
  },
  { id: "costoReemplazo", etiqueta: "Costo de reemplazo", alineaDerecha: true, texto: (a) => (a.replacementCost ? formatCurrency(a.replacementCost) : "—") },
  { id: "costoCompra", etiqueta: "Costo de compra", alineaDerecha: true, texto: (a) => (a.purchaseCost ? formatCurrency(a.purchaseCost) : "—") },
  { id: "puestaEnMarcha", etiqueta: "Puesta en marcha", texto: (a) => (a.commissionedAt ? formatDate(new Date(a.commissionedAt)) : "—") },
  { id: "vidaUtil", etiqueta: "Vida util (años)", alineaDerecha: true, texto: (a) => (a.expectedLifeYears ? `${a.expectedLifeYears}` : "—") },
];

/** La vista de fabrica: lo que se necesita para decidir a que equipo ir hoy. */
const DE_FABRICA = ["ubicacion", "criticidad", "estado", "otAbiertas", "planes", "garantia"];

export function TablaActivos({
  activos, vistaInicial, puedeEditar,
}: {
  activos: FilaActivo[];
  vistaInicial: Vista;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [borrando, setBorrando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function eliminar(a: FilaActivo) {
    if (!confirm(`Eliminar ${a.code} — ${a.name}?\n\nEsto no se puede deshacer. Si el equipo salio de operacion, mejor retirelo desde su ficha.`)) return;
    setBorrando(a.id); setError(null);
    const r = await fetch(`/api/assets/${a.id}?eliminar=1`, { method: "DELETE" });
    const data = await r.json().catch(() => ({}));
    setBorrando(null);
    if (!r.ok) { setError(data.error ?? "No fue posible eliminar el activo"); return; }
    router.refresh();
  }

  return (
    <>
      {error ? (
        <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}
      <TablaConfigurable
        filas={activos}
        fijas={FIJAS}
        columnas={COLUMNAS}
        deFabrica={DE_FABRICA}
        vistaInicial={vistaInicial}
        clave="activos"
        sustantivo="activos"
        ejemploFiltro='Filtrar: "bomba", "alberca", "critico"…'
        acciones={puedeEditar ? (a) => (
          <button
            type="button" onClick={() => eliminar(a)} disabled={borrando === a.id}
            title="Eliminar activo"
            className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
          >
            {borrando === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        ) : undefined}
      />
    </>
  );
}
