"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

export function AlertActions({
  alertId,
  hasWorkOrder,
  status,
}: {
  alertId: string;
  hasWorkOrder: boolean;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function act(action: string) {
    setLoading(action);
    const res = await fetch(`/api/alerts/${alertId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setLoading(null);
    if (res.ok && data.workOrder) {
      router.push(`/work-orders/${data.workOrder.id}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
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
      <Button size="sm" variant="secondary" onClick={() => act("RESOLVE")} disabled={loading !== null}>
        Resolver
      </Button>
      <Button size="sm" variant="ghost" onClick={() => act("DISMISS")} disabled={loading !== null}>
        Descartar
      </Button>
    </div>
  );
}
