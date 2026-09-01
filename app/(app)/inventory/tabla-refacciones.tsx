"use client";

import { Badge, Progress } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { AdjuntosRefaccion } from "./adjuntos-refaccion";
import { MovementForm } from "./movement-form";
import { PartDialog } from "./part-dialog";

type Adjunto = {
  id: string; name: string; kind: string; size: number;
  mimeType: string | null; createdAt: string; subidoPor: string | null;
};
type Enlace = { id: string; title: string; url: string; note: string | null; createdAt: string };

export type FilaRefaccion = {
  id: string; code: string; name: string;
  description: string | null; category: string | null;
  unit: string; unitCost: number;
  quantityOnHand: number; minQuantity: number; maxQuantity: number;
  bin: string | null; supplierId: string | null; proveedor: string | null;
  moneda: string;
  adjuntos: Adjunto[]; enlaces: Enlace[];
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");
const bajoMinimo = (p: FilaRefaccion) => p.quantityOnHand <= p.minQuantity;

/**
 * Que tan llena esta la ubicacion respecto de su maximo.
 *
 * Sin maximo capturado se toma el doble del minimo como referencia: es lo que
 * suele significar "surtido" en un almacen de mantenimiento. Sin ninguno de
 * los dos no hay nada contra que comparar y se pinta lleno.
 */
function nivel(p: FilaRefaccion) {
  if (p.maxQuantity) return (p.quantityOnHand / p.maxQuantity) * 100;
  if (p.minQuantity) return (p.quantityOnHand / (p.minQuantity * 2)) * 100;
  return 100;
}

export function TablaRefacciones({
  refacciones, vistaInicial, editable, suppliers, familias, unidades, puedeGestionarCatalogos,
  warehouseId,
}: {
  refacciones: FilaRefaccion[];
  vistaInicial: Vista;
  editable: boolean;
  suppliers: { id: string; name: string }[];
  familias: { code: string; name: string }[];
  unidades: { code: string; name: string }[];
  puedeGestionarCatalogos: boolean;
  /** Almacen en el que se aplican los movimientos. Nulo = el general. */
  warehouseId?: string | null;
}) {
  const FIJAS: Columna<FilaRefaccion>[] = [
    { id: "code", etiqueta: "Codigo", texto: (p) => p.code, pinta: (p) => <span className="font-medium text-slate-700">{p.code}</span> },
    {
      id: "name", etiqueta: "Refaccion",
      texto: (p) => `${p.name} ${p.description ?? ""} ${p.category ?? ""}`,
      pinta: (p) => (
        <div className="max-w-64">
          <p className="truncate font-medium text-slate-800">{p.name}</p>
          {p.category ? <p className="text-xs text-slate-500">{p.category}</p> : null}
          <div className="mt-1">
            <AdjuntosRefaccion
              partId={p.id} nombre={p.name} editable={editable}
              adjuntos={p.adjuntos} enlaces={p.enlaces}
            />
          </div>
        </div>
      ),
    },
  ];

  const COLUMNAS: Columna<FilaRefaccion>[] = [
    { id: "ubicacion", etiqueta: "Ubicacion", agrupable: true, texto: (p) => guion(p.bin) },
    { id: "proveedor", etiqueta: "Proveedor", agrupable: true, texto: (p) => guion(p.proveedor) },
    { id: "familia", etiqueta: "Familia", agrupable: true, texto: (p) => guion(p.category) },
    {
      id: "existencia", etiqueta: "Existencia", alineaDerecha: true,
      texto: (p) => `${formatNumber(p.quantityOnHand, 2)} ${p.unit}`,
      pinta: (p) => (
        <>
          <span className={`tabular-nums text-sm font-medium ${bajoMinimo(p) ? "text-red-600" : "text-slate-800"}`}>
            {formatNumber(p.quantityOnHand, 2)}
          </span>
          <span className="ml-1 text-[0.6875rem] text-slate-400">{p.unit}</span>
          {bajoMinimo(p) ? <div className="mt-0.5"><Badge tone="danger">Reordenar</Badge></div> : null}
        </>
      ),
    },
    {
      id: "nivel", etiqueta: "Nivel",
      texto: (p) => `${Math.round(nivel(p))}%`,
      pinta: (p) => (
        <div className="w-40">
          <Progress value={nivel(p)} tone={p.quantityOnHand === 0 ? "bad" : bajoMinimo(p) ? "warn" : "good"} />
          <p className="mt-1 text-[0.625rem] text-slate-400">
            min {formatNumber(p.minQuantity, 0)} · max {formatNumber(p.maxQuantity, 0)}
          </p>
        </div>
      ),
    },
    {
      id: "estado", etiqueta: "Situacion", agrupable: true,
      texto: (p) => (p.quantityOnHand === 0 ? "Agotada" : bajoMinimo(p) ? "Bajo minimo" : "Surtida"),
      pinta: (p) =>
        p.quantityOnHand === 0
          ? <Badge tone="danger">Agotada</Badge>
          : bajoMinimo(p) ? <Badge tone="warning">Bajo minimo</Badge> : <Badge tone="success">Surtida</Badge>,
    },
    { id: "costoUnit", etiqueta: "Costo unit.", alineaDerecha: true, texto: (p) => formatCurrency(p.unitCost, p.moneda) },
    { id: "valor", etiqueta: "Valor en piso", alineaDerecha: true, texto: (p) => formatCurrency(p.quantityOnHand * p.unitCost, p.moneda) },
    { id: "minimo", etiqueta: "Minimo", alineaDerecha: true, texto: (p) => formatNumber(p.minQuantity, 0) },
    { id: "maximo", etiqueta: "Maximo", alineaDerecha: true, texto: (p) => formatNumber(p.maxQuantity, 0) },
    { id: "unidad", etiqueta: "Unidad", agrupable: true, texto: (p) => p.unit },
    { id: "adjuntos", etiqueta: "Adjuntos", alineaDerecha: true, texto: (p) => String(p.adjuntos.length + p.enlaces.length) },
  ];

  /** La vista de fabrica: lo que se necesita para saber que hay que comprar. */
  const DE_FABRICA = ["ubicacion", "proveedor", "existencia", "nivel", "costoUnit", "valor"];

  return (
    <TablaConfigurable
      filas={refacciones}
      fijas={FIJAS}
      columnas={COLUMNAS}
      deFabrica={DE_FABRICA}
      vistaInicial={vistaInicial}
      clave="refacciones"
      sustantivo="refacciones"
      ejemploFiltro='Filtrar: "balero", "agotada", "filtro"…'
      acciones={editable ? (p) => (
        <div className="flex items-center justify-end gap-1.5">
          <MovementForm partId={p.id} unit={p.unit} warehouseId={warehouseId} />
          <PartDialog
            suppliers={suppliers}
            familias={familias}
            unidades={unidades}
            puedeGestionarCatalogos={puedeGestionarCatalogos}
            refaccion={{
              id: p.id, code: p.code, name: p.name,
              description: p.description, category: p.category,
              unit: p.unit, unitCost: p.unitCost,
              minQuantity: p.minQuantity, maxQuantity: p.maxQuantity,
              bin: p.bin, supplierId: p.supplierId,
            }}
          />
        </div>
      ) : undefined}
    />
  );
}
