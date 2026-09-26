"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Proponer los centros de costo de una instalación como la suya.
 *
 * Lo que se propone es la ESTRUCTURA —qué conviene separar—, y quien abre una
 * cuenta casi nunca la sabe. Las CLAVES son otra cosa: son la llave para
 * conciliar con su contabilidad, así que se dicen provisionales aquí mismo y
 * no en la ayuda. Si se quedan las de fábrica y su contador usa otras, el
 * costo por centro deja de servir para hablar con finanzas, y eso se descubre
 * meses después.
 */
export function ProponerCentros({ instalacion }: { instalacion: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hechos, setHechos] = useState<string[] | null>(null);

  async function proponer() {
    setOcupado(true); setError(null);
    const r = await fetch("/api/centros-de-costo/sugeridos", { method: "POST" });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      setError(d?.error ?? "No fue posible dar de alta los centros propuestos");
      return;
    }
    const d = await r.json();
    setHechos((d.creados ?? []).map((c: { code: string; name: string }) => `${c.code} ${c.name}`));
    router.refresh();
  }

  if (hechos) {
    return (
      <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-3 text-xs text-emerald-900">
        <p className="font-medium">Se dieron de alta {hechos.length}: {hechos.join(", ")}.</p>
        <p className="mt-1">
          <strong>Ahora cambie las claves por las de su contabilidad.</strong> Son la llave para conciliar:
          si su contador usa otras, el costo por centro no le va a cuadrar con finanzas.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3">
      <p className="text-xs text-slate-700">
        ¿No sabe por dónde empezar? Podemos proponer los que suele tener{" "}
        <strong>{instalacion}</strong>. Son un punto de partida:{" "}
        <strong>las claves hay que cambiarlas por las de su contabilidad</strong>, porque son la llave
        para conciliar el gasto con finanzas. Lo que ya tenga capturado no se toca.
      </p>
      {error ? <p className="mt-1.5 text-xs text-amber-800">{error}</p> : null}
      <Button size="sm" variant="secondary" onClick={proponer} disabled={ocupado} className="mt-2">
        {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Proponer centros de costo
      </Button>
    </div>
  );
}
