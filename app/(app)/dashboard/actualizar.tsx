"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

/**
 * De cuando son los indicadores del inicio, y como pedirlos de nuevo.
 *
 * Los indicadores y la calidad de datos salen de un resumen que se recalcula
 * cada cuarto de hora (lib/resumen-inicio.ts). Decirlo no es un detalle: quien
 * acaba de cerrar cinco ordenes y ve que el cumplimiento no se movio concluye
 * que el sistema no sirve. Con la hora a la vista, entiende; y si no quiere
 * esperar, lo actualiza.
 */
export function CuandoSeCalculo({ calculadoEl }: { calculadoEl: string }) {
  const router = useRouter();
  const [cargando, empezar] = useTransition();
  const [pidiendo, setPidiendo] = useState(false);

  const minutos = Math.max(0, Math.round((Date.now() - new Date(calculadoEl).getTime()) / 60_000));
  const cuando = minutos < 1 ? "hace un momento" : minutos < 60 ? `hace ${minutos} min` : `hace ${Math.round(minutos / 60)} h`;

  async function actualizar() {
    setPidiendo(true);
    try {
      await fetch("/api/inicio/actualizar", { method: "POST" });
      empezar(() => router.refresh());
    } finally {
      setPidiendo(false);
    }
  }

  const ocupado = pidiendo || cargando;
  return (
    <p className="mb-5 -mt-3 flex items-center gap-2 text-[0.6875rem] text-slate-500">
      <span>Cumplimiento, disponibilidad y costo, calculados {cuando}.</span>
      <button
        type="button"
        onClick={actualizar}
        disabled={ocupado}
        className="inline-flex items-center gap-1 rounded px-1 font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-60"
      >
        {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {ocupado ? "Actualizando…" : "Actualizar"}
      </button>
    </p>
  );
}
