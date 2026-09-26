"use client";

import { useZona } from "@/components/zona-empresa";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { ProveedorDialog, type ProveedorEditable } from "./proveedor-dialog";

export type FilaProveedor = ProveedorEditable & {
  refacciones: number;
  refaccionesBajoMinimo: number;
  valorEnPiso: number;
  serviciosCatalogo: number;
  serviciosPrestados: number;
  gastoAcumulado: number;
  ultimoServicio: string | null;
  moneda: string;
};

const guion = (v: string | null | undefined) => (v && v.trim() ? v : "—");

/** Las columnas llevan la zona de la empresa: sin ella el servidor (UTC) y el navegador formatean distinto (#418). */
const crearColumnas = (zona: string): Columna<FilaProveedor>[] => [
  { id: "telefono", etiqueta: "Telefono", texto: (p) => guion(p.phone) },
  {
    id: "correo", etiqueta: "Correo", texto: (p) => guion(p.email),
    pinta: (p) => p.email
      ? <a href={`mailto:${p.email}`} className="text-brand-600 hover:underline">{p.email}</a>
      : "—",
  },
  { id: "direccion", etiqueta: "Dirección", texto: (p) => guion(p.address) },
  {
    id: "entrega", etiqueta: "Días de entrega", alineaDerecha: true, agrupable: true,
    texto: (p) => `${p.leadTimeDays} d`,
  },
  { id: "refacciones", etiqueta: "Refacciones que surte", alineaDerecha: true, texto: (p) => String(p.refacciones) },
  {
    // La columna que convierte la lista en una accion: a quien hay que
    // llamarle hoy. Agrupar por proveedor y mirar esta cifra es una orden de
    // compra por renglon.
    id: "porComprar", etiqueta: "Bajo mínimo", alineaDerecha: true,
    texto: (p) => String(p.refaccionesBajoMinimo),
    pinta: (p) => p.refaccionesBajoMinimo
      ? <Badge tone="danger">{p.refaccionesBajoMinimo} por comprar</Badge>
      : <span className="text-slate-300">—</span>,
  },
  { id: "valorEnPiso", etiqueta: "Valor en piso", alineaDerecha: true, texto: (p) => formatCurrency(p.valorEnPiso, p.moneda), ordenPor: (p) => p.valorEnPiso },
  { id: "serviciosCatalogo", etiqueta: "Servicios en catálogo", alineaDerecha: true, texto: (p) => String(p.serviciosCatalogo) },
  { id: "serviciosPrestados", etiqueta: "Servicios prestados", alineaDerecha: true, texto: (p) => String(p.serviciosPrestados) },
  { id: "gasto", etiqueta: "Gasto acumulado", alineaDerecha: true, texto: (p) => formatCurrency(p.gastoAcumulado, p.moneda), ordenPor: (p) => p.gastoAcumulado },
  {
    id: "ultimo", etiqueta: "Último servicio",
    texto: (p) => (p.ultimoServicio ? new Date(p.ultimoServicio).toLocaleDateString("es-MX", { timeZone: zona }) : "—"),
  },
  {
    id: "relacion", etiqueta: "Relacion", agrupable: true,
    texto: (p) =>
      p.refacciones && p.serviciosPrestados ? "Surte y presta servicio"
        : p.refacciones ? "Solo refacciones"
        : p.serviciosPrestados || p.serviciosCatalogo ? "Solo servicios"
        : "Sin movimiento",
  },
  { id: "notas", etiqueta: "Notas", texto: (p) => guion(p.notes) },
];

/** La vista de fabrica: con quien se trata y que le falta surtir. */
const DE_FABRICA = ["telefono", "correo", "entrega", "refacciones", "porComprar", "gasto"];

export function TablaProveedores({
  proveedores, vistaInicial, editable,
}: {
  proveedores: FilaProveedor[];
  vistaInicial: Vista;
  editable: boolean;
}) {
  const zona = useZona();
  const columnas = useMemo(() => crearColumnas(zona), [zona]);
  const router = useRouter();
  const [borrando, setBorrando] = useState<string | null>(null);

  /**
   * El nombre abre la ficha del proveedor.
   *
   * Un nombre subrayado se entiende solo —se toca y entra— y le quita un
   * control al renglon. Se arma aqui adentro y no fuera del componente porque
   * necesita saber si la cuenta puede editar: quien solo consulta ve el
   * nombre como texto, sin invitar a un clic que no lleva a ningun lado.
   */
  const FIJAS: Columna<FilaProveedor>[] = [
    {
      id: "name", etiqueta: "Proveedor",
      texto: (p) => `${p.name} ${p.contactName ?? ""} ${p.notes ?? ""}`,
      pinta: (p) => (
        <div className="max-w-64">
          {editable ? (
            <ProveedorDialog
              proveedor={p}
              disparador={(abrir) => (
                <button
                  type="button"
                  onClick={abrir}
                  title={`Ver y editar ${p.name}`}
                  className="block max-w-full truncate text-left font-medium text-brand-600 underline decoration-brand-300 underline-offset-2 hover:text-brand-800 hover:decoration-brand-600"
                >
                  {p.name}
                </button>
              )}
            />
          ) : (
            <p className="truncate font-medium text-slate-800">{p.name}</p>
          )}
          <p className="truncate text-xs text-slate-500">{guion(p.contactName)}</p>
        </div>
      ),
    },
  ];
  const [error, setError] = useState<string | null>(null);

  async function eliminar(p: FilaProveedor) {
    if (!confirm(`Borrar a ${p.name}?\n\nSolo procede si no tiene refacciones ni servicios ligados.`)) return;
    setBorrando(p.id); setError(null);
    const r = await fetch(`/api/suppliers/${p.id}`, { method: "DELETE" });
    const data = await r.json().catch(() => ({}));
    setBorrando(null);
    if (!r.ok) { setError(data.error ?? "No fue posible borrar el proveedor"); return; }
    router.refresh();
  }

  return (
    <>
      {error ? (
        <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>
      ) : null}
      <TablaConfigurable
        filas={proveedores}
        fijas={FIJAS}
        columnas={columnas}
        deFabrica={DE_FABRICA}
        vistaInicial={vistaInicial}
        clave="proveedores"
        sustantivo="proveedores"
        ejemploFiltro='Filtrar: "rodamientos", "local", "urgente"…'
        acciones={editable ? (p) => (
          <div className="flex items-center justify-end gap-1">
            {/* La ficha se abre desde el nombre; aqui solo queda borrar. */}
            <button
              type="button" onClick={() => eliminar(p)} disabled={borrando === p.id}
              title="Borrar proveedor"
              className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
            >
              {borrando === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : undefined}
      />
    </>
  );
}
