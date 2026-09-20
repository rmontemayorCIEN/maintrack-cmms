"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Pasar de un registro al siguiente sin volver a la lista.
 *
 * La secuencia es la que la persona tenía enfrente: la lista con su filtro,
 * su orden y sus grupos, en el orden en que se ve. La lista la guarda en la
 * pestaña (`RegistrarLista`) y el detalle la lee (`PasarRegistros`).
 *
 * Por eso las flechas aparecen solo cuando se llegó desde esa lista: si se
 * entró por una búsqueda, por un aviso o por una liga directa, «siguiente» no
 * significaría nada y no se muestran. Vive en la pestaña (sessionStorage): no
 * se comparte entre pestañas ni se queda después de cerrar.
 */

const LLAVE = "mt_lista";
/** Suficiente para recorrer una lista larga sin llenar el almacenamiento de la pestaña. */
const MAXIMO = 500;

type Guardada = { base: string; items: Array<{ id: string; etiqueta: string }> };

/** La lista, tal como se ve, para poder recorrerla desde el detalle. */
export function RegistrarLista({ base, items }: { base: string; items: Array<{ id: string; etiqueta: string }> }) {
  useEffect(() => {
    try { sessionStorage.setItem(LLAVE, JSON.stringify({ base, items: items.slice(0, MAXIMO) })); }
    catch { /* sin almacenamiento: el detalle simplemente no ofrece las flechas */ }
  }, [base, items]);
  return null;
}

export function PasarRegistros({ base, id }: { base: string; id: string }) {
  const [guardada, setGuardada] = useState<Guardada | null>(null);
  useEffect(() => {
    try {
      const crudo = sessionStorage.getItem(LLAVE);
      const g = crudo ? (JSON.parse(crudo) as Guardada) : null;
      setGuardada(g && g.base === base && g.items?.some((x) => x.id === id) ? g : null);
    } catch { setGuardada(null); }
  }, [base, id]);

  const i = guardada ? guardada.items.findIndex((x) => x.id === id) : -1;
  const anterior = i > 0 ? guardada!.items[i - 1] : null;
  const siguiente = guardada && i >= 0 && i < guardada.items.length - 1 ? guardada.items[i + 1] : null;

  // Las flechas del teclado hacen lo mismo, mientras no se esté escribiendo ni
  // haya una ventana abierta encima.
  useEffect(() => {
    if (!guardada) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const d = e.target as HTMLElement | null;
      if (d && (d.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(d.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      const destino = e.key === "ArrowLeft" ? anterior : siguiente;
      if (destino) window.location.assign(`${base}/${destino.id}`);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [guardada, anterior, siguiente, base]);

  if (!guardada || i < 0) return null;
  const boton = "inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-1.5 text-slate-600 hover:bg-slate-50 lg:min-h-8 lg:min-w-8";

  return (
    <span className="inline-flex items-center gap-1.5 no-print" role="group" aria-label="Pasar de registro">
      {anterior
        ? <Link href={`${base}/${anterior.id}`} className={boton} aria-label={`Anterior: ${anterior.etiqueta}`} title={`Anterior: ${anterior.etiqueta}`} rel="prev"><ChevronLeft className="h-4 w-4" /></Link>
        : <span className={`${boton} opacity-40`} aria-hidden><ChevronLeft className="h-4 w-4" /></span>}
      <span className="tabular-nums text-slate-500">{i + 1} de {guardada.items.length}</span>
      {siguiente
        ? <Link href={`${base}/${siguiente.id}`} className={boton} aria-label={`Siguiente: ${siguiente.etiqueta}`} title={`Siguiente: ${siguiente.etiqueta}`} rel="next"><ChevronRight className="h-4 w-4" /></Link>
        : <span className={`${boton} opacity-40`} aria-hidden><ChevronRight className="h-4 w-4" /></span>}
    </span>
  );
}
