"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ChevronUp, Minus, X } from "lucide-react";
import { puedeVerRuta } from "@/lib/pantallas";
import { PASOS_RECORRIDO } from "@/lib/demo-guia";

const LLAVE = "mt_recorrido_demo";
export const EVENTO_REINICIAR = "mt:recorrido-demo";

type Estado = { paso: number; descartado: boolean; plegado?: boolean };

function leer(): Estado {
  try { return { paso: 0, descartado: false, ...JSON.parse(localStorage.getItem(LLAVE) ?? "{}") }; } catch { return { paso: 0, descartado: false }; }
}
function guardar(e: Estado) {
  try { localStorage.setItem(LLAVE, JSON.stringify(e)); } catch { /* sin almacenamiento: el recorrido vive solo en esta visita */ }
}

/**
 * Recorrido guiado de la empresa demostrativa.
 *
 * Una tarjeta chica abajo a la derecha, no un globo sobre cada botón. Cada
 * paso lleva a una pantalla real con datos reales. Se omite con un clic y no
 * vuelve a aparecer; se reinicia desde la guía. Solo muestra los pasos que el
 * rol puede abrir.
 *
 * ── Por qué se puede plegar ──
 *
 * Aquí decía que «no tapa la operación», y no era cierto. Medido en una
 * pantalla de 1280 × 900 sobre el almacén: la tarjeta cubría CINCO controles
 * de los 49 visibles —tres renglones de la franja, la liga de las refacciones
 * sin mínimo y el botón de ocultar—. Quien enseña el producto se topa con que
 * un botón no responde, y lo que falla no es el botón.
 *
 * Se pliega a una pastilla que dice en qué paso va, y se vuelve a abrir de un
 * toque. Plegado se sigue sabiendo que el recorrido está ahí —desaparecer del
 * todo haría pensar que se perdió—, pero deja de estorbar.
 *
 * La preferencia se guarda con el paso: quien lo plegó una vez no quiere
 * volver a plegarlo en cada pantalla.
 */
export function RecorridoDemo({ rol }: { rol: string }) {
  const pathname = usePathname();
  const pasos = useMemo(() => PASOS_RECORRIDO.filter((p) => puedeVerRuta(rol, p.href, { esDemo: true })), [rol]);
  const [e, setE] = useState<Estado | null>(null);

  useEffect(() => {
    const guardado = leer();
    /*
     * En el teléfono nace plegado.
     *
     * La tarjeta mide 22rem: en una pantalla de 390 px se come la mitad de lo
     * util y tapa justo la fila de botones de abajo. En computadora cabe de
     * sobra y ahi si conviene verla abierta, que para eso es el recorrido.
     *
     * Solo cuando NADIE ha decidido todavia: si ya la abrio o la plego a
     * mano, manda su decision, tambien en el telefono.
     */
    const sinDecidir = guardado.plegado === undefined;
    const angosta = typeof window !== "undefined" && window.innerWidth < 1024;
    setE(sinDecidir && angosta ? { ...guardado, plegado: true } : guardado);
    const reiniciar = () => { const n = { paso: 0, descartado: false }; guardar(n); setE(n); };
    window.addEventListener(EVENTO_REINICIAR, reiniciar);
    return () => window.removeEventListener(EVENTO_REINICIAR, reiniciar);
  }, []);

  if (!e || e.descartado || e.paso >= pasos.length || !pasos.length) return null;
  const paso = pasos[e.paso];
  const aqui = pathname === paso.href.split("?")[0];
  const cambiar = (n: Estado) => { guardar(n); setE(n); };

  const anclaje = "fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] right-3 z-40 no-print lg:bottom-4";

  if (e.plegado) {
    return (
      // Plegado tambien se puede quitar del todo. Sin esta X habia que abrirlo
      // primero para poder omitirlo, que es pedirle al usuario que haga
      // aparecer lo que quiere que desaparezca.
      <aside aria-label="Recorrido de la demostración" className={`${anclaje} flex items-center gap-1 rounded-full border border-violet-200 bg-white pr-1 shadow-lg`}>
        <button
          type="button"
          onClick={() => cambiar({ ...e, plegado: false })}
          aria-expanded={false}
          className="inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50"
        >
          Recorrido · {e.paso + 1} de {pasos.length}
          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => cambiar({ ...e, descartado: true })}
          aria-label="Omitir el recorrido"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside aria-label="Recorrido de la demostración" className={`${anclaje} w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-violet-200 bg-white p-4 shadow-lg`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-violet-700">Recorrido · {e.paso + 1} de {pasos.length}</p>
        <div className="-m-1 flex items-center">
          <button type="button" onClick={() => cambiar({ ...e, plegado: true })} aria-label="Plegar el recorrido" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><Minus className="h-4 w-4" /></button>
          <button type="button" onClick={() => cambiar({ ...e, descartado: true })} aria-label="Omitir el recorrido" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <p className="mt-1 font-semibold text-slate-900">{paso.titulo}</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{paso.texto}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {aqui ? null : <Link href={paso.href} className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white hover:bg-violet-700">Abrir {paso.pantalla} <ArrowRight className="h-3.5 w-3.5" /></Link>}
        <button type="button" onClick={() => cambiar({ ...e, paso: e.paso + 1 })} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {e.paso + 1 === pasos.length ? "Terminar" : "Siguiente"}
        </button>
        {e.paso > 0 ? <button type="button" onClick={() => cambiar({ ...e, paso: e.paso - 1 })} className="min-h-10 px-2 text-sm text-slate-500 hover:text-slate-800">Anterior</button> : null}
        <button type="button" onClick={() => cambiar({ ...e, descartado: true })} className="ml-auto min-h-10 px-1 text-xs text-slate-500 hover:text-slate-800">Omitir</button>
      </div>
    </aside>
  );
}
