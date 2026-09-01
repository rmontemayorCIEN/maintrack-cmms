"use client";

import { useState } from "react";
import { ChevronDown, Link2 } from "lucide-react";
import { Enlaces, type Enlace } from "@/components/enlaces";
import { cn } from "@/lib/utils";

/**
 * Enlaces de un plan, plegados dentro de la tabla.
 *
 * El caso tipico es el procedimiento: el instructivo del fabricante, el video
 * de la rutina o la norma que exige esa frecuencia. Van aqui y no como archivo
 * porque suelen vivir y actualizarse fuera del sistema.
 */
export function EnlacesPlan({
  planId,
  nombre,
  enlaces,
  editable,
}: {
  planId: string;
  nombre: string;
  enlaces: Enlace[];
  editable: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title={`Enlaces de ${nombre}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[0.6875rem] transition-colors",
          enlaces.length
            ? "border-brand-200 bg-brand-50 text-brand-700"
            : "border-slate-200 text-slate-400 hover:bg-slate-50",
        )}
      >
        <Link2 className="h-3 w-3" />
        {enlaces.length || ""}
        <ChevronDown className={cn("h-3 w-3 transition-transform", abierto && "rotate-180")} />
      </button>

      {abierto ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <Enlaces
            destino={{ planId }}
            enlaces={enlaces}
            editable={editable}
            titulo={`Enlaces de ${nombre}`}
            ayuda="Instructivo del fabricante, video de la rutina, norma que exige la frecuencia."
          />
        </div>
      ) : null}
    </>
  );
}
