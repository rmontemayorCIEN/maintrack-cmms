"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Generacion manual del diagnostico.
 *
 * Se avisa cuantas operaciones quedan antes de gastar una: el cliente paga por
 * una bolsa mensual y no debe descubrir el consumo despues.
 */
export function BotonDiagnostico({ disponible, restantes }: { disponible: boolean; restantes: number }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generar() {
    setCargando(true);
    setError(null);
    const res = await fetch("/api/ia/diagnostico", { method: "POST" });
    const data = await res.json();
    setCargando(false);
    if (!res.ok || data.error) {
      setError(data.error ?? "No fue posible generar el diagnóstico");
      return;
    }
    router.refresh();
  }

  if (!disponible) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={generar} disabled={cargando || restantes < 1}>
        {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {cargando ? "Analizando…" : "Generar ahora"}
      </Button>
      <span className="text-[0.6875rem] text-slate-400">
        {restantes < 1 ? "Sin operaciones disponibles este mes" : `${restantes} operaciones disponibles`}
      </span>
      {error ? <span className="max-w-xs text-right text-[0.6875rem] text-red-600">{error}</span> : null}
    </div>
  );
}
