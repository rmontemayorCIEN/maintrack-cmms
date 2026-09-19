"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { pedir } from "@/lib/cliente/pedir";

/** «Aceptar» la orden asignada (sin iniciarla todavía). */
export function AceptarOrden({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function aceptar() {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const r = await pedir(`/api/work-orders/${workOrderId}/aceptar`, { method: "POST" });
    setEnviando(false);
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
  }
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={aceptar} disabled={enviando}>
        {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Aceptar
      </Button>
      {error ? <p role="alert" className="basis-full text-xs text-red-700">{error}</p> : null}
    </>
  );
}
