"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { puedeVerRuta } from "@/lib/pantallas";
import { PASOS_RECORRIDO } from "@/lib/demo-guia";

const LLAVE = "mt_recorrido_demo";
export const EVENTO_REINICIAR = "mt:recorrido-demo";

type Estado = { paso: number; descartado: boolean };

function leer(): Estado {
  try { return { paso: 0, descartado: false, ...JSON.parse(localStorage.getItem(LLAVE) ?? "{}") }; } catch { return { paso: 0, descartado: false }; }
}
function guardar(e: Estado) {
  try { localStorage.setItem(LLAVE, JSON.stringify(e)); } catch { /* sin almacenamiento: el recorrido vive solo en esta visita */ }
}

/**
 * Recorrido guiado de la empresa demostrativa.
 *
 * Una tarjeta chica abajo a la derecha, no un globo sobre cada botón: no tapa
 * la operación ni la bloquea. Cada paso lleva a una pantalla real con datos
 * reales. Se omite con un clic y no vuelve a aparecer; se reinicia desde la
 * guía de la demostración. Solo muestra los pasos que el rol puede abrir.
 */
export function RecorridoDemo({ rol }: { rol: string }) {
  const pathname = usePathname();
  const pasos = useMemo(() => PASOS_RECORRIDO.filter((p) => puedeVerRuta(rol, p.href, { esDemo: true })), [rol]);
  const [e, setE] = useState<Estado | null>(null);

  useEffect(() => {
    setE(leer());
    const reiniciar = () => { const n = { paso: 0, descartado: false }; guardar(n); setE(n); };
    window.addEventListener(EVENTO_REINICIAR, reiniciar);
    return () => window.removeEventListener(EVENTO_REINICIAR, reiniciar);
  }, []);

  if (!e || e.descartado || e.paso >= pasos.length || !pasos.length) return null;
  const paso = pasos[e.paso];
  const aqui = pathname === paso.href.split("?")[0];
  const cambiar = (n: Estado) => { guardar(n); setE(n); };

  return (
    <aside aria-label="Recorrido de la demostración" className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] right-3 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-violet-200 bg-white p-4 shadow-lg no-print lg:bottom-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-violet-700">Recorrido · {e.paso + 1} de {pasos.length}</p>
        <button type="button" onClick={() => cambiar({ ...e, descartado: true })} aria-label="Omitir el recorrido" className="-m-1 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
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
