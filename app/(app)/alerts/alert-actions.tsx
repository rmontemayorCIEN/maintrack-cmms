"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

export function AlertActions({
  alertId,
  hasWorkOrder,
  status,
  normalizada,
}: {
  alertId: string;
  hasWorkOrder: boolean;
  status: string;
  /** El punto regreso a normal: se ofrece validar en vez de dejarla cerrarse sola. */
  normalizada: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  async function act(action: string, nota?: string) {
    setLoading(action);
    setError(null);
    const res = await fetch(`/api/alerts/${alertId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, nota }),
    });
    const data = await res.json();
    setLoading(null);
    if (!res.ok) {
      setError(data.error ?? "No fue posible actualizar la alerta");
      return;
    }
    if (res.ok && data.workOrder) {
      router.push(`/work-orders/${data.workOrder.id}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {error ? <p className="w-full text-xs text-red-600">{error}</p> : null}
      {!hasWorkOrder ? (
        <Button size="sm" onClick={() => act("CREATE_WORK_ORDER")} disabled={loading !== null}>
          {loading === "CREATE_WORK_ORDER" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Generar OT
        </Button>
      ) : null}
      {status === "OPEN" ? (
        <Button size="sm" variant="secondary" onClick={() => act("ACKNOWLEDGE")} disabled={loading !== null}>
          Reconocer
        </Button>
      ) : null}
      {normalizada ? (
        <Button size="sm" variant="success" onClick={() => act("VALIDATE_NORMALIZATION")} disabled={loading !== null}>
          Validar normalización
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const nota = window.prompt("¿Por qué se descarta? (por ejemplo: falsa alarma por sensor desconectado)");
          if (nota && nota.trim().length >= 3) void act("DISMISS", nota.trim());
        }}
        disabled={loading !== null}
      >
        Descartar
      </Button>
    </div>
  );
}
