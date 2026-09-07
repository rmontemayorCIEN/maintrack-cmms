"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Paperclip } from "lucide-react";
import { Adjuntos, type Adjunto } from "@/components/adjuntos";
import { Enlaces, type Enlace } from "@/components/enlaces";
import { cn } from "@/lib/utils";

/**
 * Adjuntos de una refaccion, plegados dentro de la tabla del almacen.
 *
 * El caso real es la foto: quien va por la pieza al anaquel la reconoce mejor
 * viendola que leyendo "reten 45x62x8". Tambien caben fichas tecnicas.
 */
export function AdjuntosRefaccion({
  partId,
  nombre,
  adjuntos,
  enlaces,
  editable,
}: {
  partId: string;
  nombre: string;
  adjuntos: Adjunto[];
  enlaces: Enlace[];
  editable: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [contenedor, setContenedor] = useState<HTMLElement | null>(null);
  const ancla = useRef<HTMLSpanElement>(null);

  // Se crea un <tr> justo debajo del renglon de la refaccion y se pinta ahi
  // el panel, de modo que ocupe todo el ancho de la tabla.
  useEffect(() => {
    if (!abierto) { setContenedor(null); return; }
    const fila = ancla.current?.closest("tr");
    const tabla = fila?.closest("table");
    if (!fila || !tabla) return;

    const columnas = tabla.querySelectorAll("thead th").length || 1;
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columnas;
    td.style.padding = "0 0.9rem 0.9rem";
    tr.appendChild(td);
    fila.after(tr);
    setContenedor(td);
    return () => { tr.remove(); };
  }, [abierto]);

  return (
    <span ref={ancla}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title={`Archivos de ${nombre}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[0.6875rem] transition-colors",
          adjuntos.length
            ? "border-brand-200 bg-brand-50 text-brand-700"
            : "border-slate-200 text-slate-400 hover:bg-slate-50",
        )}
      >
        <Paperclip className="h-3 w-3" />
        {adjuntos.length + enlaces.length || ""}
        <ChevronDown className={cn("h-3 w-3 transition-transform", abierto && "rotate-180")} />
      </button>

      {/* El panel se pinta fuera de la celda, en un renglon completo: dentro
          de la columna del nombre no cabrian ni las miniaturas ni el formulario. */}
      {abierto && contenedor
        ? createPortal(
            <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
          <Adjuntos
            destino={{ partId }}
            adjuntos={adjuntos}
            editable={editable}
            titulo={`Archivos de ${nombre}`}
            ayuda="Foto de la pieza, ficha tecnica, número de parte del fabricante."
          />
              <div className="border-t border-slate-200 pt-4">
                <Enlaces
                  destino={{ partId }}
                  enlaces={enlaces}
                  editable={editable}
                  ayuda="Ficha del fabricante, pagina del proveedor, equivalencias."
                />
              </div>
            </div>,
            contenedor,
          )
        : null}
    </span>
  );
}
