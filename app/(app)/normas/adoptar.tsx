"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Card } from "@/components/ui";
import type { NormaDeCatalogo } from "@/lib/normas-catalogo";
import { ORIGENES_NORMA } from "@/lib/normas-tipos";

/**
 * Las normas del catálogo que la empresa todavía no sigue.
 *
 * Las de su giro van primero y las demás detrás, plegadas: que una norma no
 * sea típica de su giro no significa que no le aplique, y esconderlas del todo
 * sería decidir por el cliente. Pero ponerlas al mismo nivel haría que la
 * lista de una planta empiece con normas de hotel.
 *
 * Importa de `normas-tipos` y `normas-catalogo` —los dos sin prisma— y NUNCA
 * de `lib/normas.ts`.
 */
export function Adoptar({ delGiro, otras }: { delGiro: NormaDeCatalogo[]; otras: NormaDeCatalogo[] }) {
  const router = useRouter();
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verOtras, setVerOtras] = useState(false);

  async function adoptar(clave: string) {
    setOcupada(clave);
    setError(null);
    const r = await fetch("/api/normas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave, delCatalogo: true }),
    });
    setOcupada(null);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "No se pudo agregar.");
      return;
    }
    router.refresh();
  }

  const fila = (n: NormaDeCatalogo) => (
    <div key={n.clave} className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">{n.clave} — {n.titulo}</p>
        <p className="mt-0.5 text-xs text-slate-600">{n.resumen}</p>
        <p className="mt-1 text-[0.6875rem] text-slate-400">
          {n.obligaciones.length} obligaciones · {ORIGENES_NORMA.CATALOGO.promesa}
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => adoptar(n.clave)} disabled={ocupada === n.clave}>
        {ocupada === n.clave ? "Agregando…" : <><Plus className="mr-1 h-3 w-3" aria-hidden /> Seguir</>}
      </Button>
    </div>
  );

  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900">Agregar del catálogo</h2>
      {delGiro.length ? (
        <>
          <p className="mt-0.5 text-xs text-slate-500">Las que suelen aplicar a una empresa como la suya.</p>
          <div className="mt-2">{delGiro.map(fila)}</div>
        </>
      ) : (
        <p className="mt-0.5 text-xs text-slate-500">Ya está siguiendo todas las de su giro.</p>
      )}

      {otras.length ? (
        <div className="mt-4 border-t border-slate-200 pt-3">
          <button type="button" onClick={() => setVerOtras(!verOtras)} className="text-xs text-slate-600 underline">
            {verOtras ? "Ocultar" : `Ver otras ${otras.length} del catálogo`}
          </button>
          {verOtras ? <div className="mt-2">{otras.map(fila)}</div> : null}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
    </Card>
  );
}
