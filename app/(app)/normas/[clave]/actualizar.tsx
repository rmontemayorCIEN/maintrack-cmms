"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";

/**
 * La norma cambió en el catálogo desde que esta empresa la adoptó.
 *
 * Actualizar solo AGREGA lo que falta: no borra ni pisa lo que el cliente ya
 * amarró ni lo que marcó como que no aplica. Su trabajo no se tira porque
 * nosotros publicamos una versión, y eso se dice aquí para que nadie dude
 * antes de apretar el botón.
 */
export function Actualizar({ normaId }: { normaId: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function actualizar() {
    setOcupado(true);
    setError(null);
    const r = await fetch(`/api/normas/${normaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actualizar: true }),
    });
    setOcupado(false);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? "No se pudo actualizar.");
      return;
    }
    router.refresh();
  }

  return (
    <Card className="border-amber-300 bg-amber-50">
      <p className="text-sm font-medium text-amber-900">Esta norma cambió desde que usted la adoptó</p>
      <p className="mt-1 text-xs text-amber-800">
        Al actualizar se agregan las obligaciones nuevas. Lo que ya tiene amarrado y lo que marcó como que no
        aplica se conserva tal cual.
      </p>
      <Button size="sm" className="mt-2" onClick={actualizar} disabled={ocupado}>
        {ocupado ? "Actualizando…" : "Actualizar desde el catálogo"}
      </Button>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </Card>
  );
}
