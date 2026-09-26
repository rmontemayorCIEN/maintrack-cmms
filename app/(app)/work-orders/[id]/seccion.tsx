"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Una sección de la orden que nace abierta o recogida según en qué va el
 * trabajo (ver `lib/secciones-orden.ts`).
 *
 * El encabezado plegable SUSTITUYE al de la tarjeta: si se dejaran los dos, el
 * título se leería dos veces cada vez que se abre. Por eso la tarjeta de
 * dentro va sin su CardHeader y el nombre vive aquí.
 *
 * Se pliega en los dos tamaños, no solo en el teléfono: en escritorio la orden
 * también es larga, y el índice del costado no sirve de nada si todo está
 * siempre desplegado.
 */
export function SeccionPlegable({
  id, titulo, subtitulo, abiertaPorOmision, children,
}: {
  id: string;
  titulo: string;
  subtitulo?: string | null;
  abiertaPorOmision: boolean;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(abiertaPorOmision);
  return (
    <section id={id} className="grid min-w-0 scroll-mt-28 grid-cols-[minmax(0,1fr)] content-start gap-4">
      <details
        open={abierta}
        onToggle={(e) => setAbierta((e.currentTarget as HTMLDetailsElement).open)}
        className="group min-w-0 rounded-xl border border-slate-200 bg-white"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{titulo}</span>
          {subtitulo ? (
            <span className="shrink-0 text-xs font-normal text-slate-500">{subtitulo}</span>
          ) : null}
        </summary>
        <div className="border-t border-slate-100 px-4 py-3">{children}</div>
      </details>
    </section>
  );
}
