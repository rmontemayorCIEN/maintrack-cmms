"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Power, Trash2 } from "lucide-react";

export function PlanRowActions({ planId, active }: { planId: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    await fetch(`/api/plans/${planId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("¿Eliminar este plan? Las ordenes ya generadas se conservan.")) return;
    setBusy(true);
    await fetch(`/api/plans/${planId}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex justify-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={active ? "Desactivar" : "Activar"}
        className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <Power className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        title="Eliminar"
        className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
