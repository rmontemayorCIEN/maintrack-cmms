"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Información secundaria que en el teléfono va plegada (se abre con un toque)
 * y en computadora se muestra abierta. No se oculta nada: solo se acomoda para
 * que lo del trabajo quede arriba.
 */
export function Plegable({ titulo, children, id }: { titulo: string; children: React.ReactNode; id?: string }) {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const ancho = window.matchMedia("(min-width: 1024px)");
    if (ancho.matches) setAbierto(true);
  }, []);
  return (
    <details id={id} open={abierto} onToggle={(e) => setAbierto((e.currentTarget as HTMLDetailsElement).open)} className="group min-w-0 scroll-mt-28">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 lg:hidden [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" aria-hidden />
        {titulo}
      </summary>
      <div className="mt-2 grid min-w-0 gap-4 lg:mt-0">{children}</div>
    </details>
  );
}
