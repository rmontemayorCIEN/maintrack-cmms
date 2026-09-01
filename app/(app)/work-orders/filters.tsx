"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Download, X } from "lucide-react";
import {
  MAINTENANCE_TYPE_LABELS,
  PRIORITY_LABELS,
  WO_STATUS_LABELS,
} from "@/lib/constants";

export function WorkOrderFilters({
  technicians,
}: {
  technicians: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/work-orders?${next.toString()}`);
  }

  const active = ["status", "type", "priority", "assignedToId", "q"].filter((k) => params.get(k));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        defaultValue={params.get("q") ?? ""}
        onKeyDown={(e) => {
          if (e.key === "Enter") update("q", (e.target as HTMLInputElement).value);
        }}
        placeholder="Buscar folio o descripcion…"
        className="field max-w-56"
      />
      <select className="field max-w-44" value={params.get("status") ?? ""} onChange={(e) => update("status", e.target.value)}>
        <option value="">Todos los estados</option>
        {Object.entries(WO_STATUS_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
      <select className="field max-w-44" value={params.get("type") ?? ""} onChange={(e) => update("type", e.target.value)}>
        <option value="">Todos los tipos</option>
        {Object.entries(MAINTENANCE_TYPE_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
      <select className="field max-w-40" value={params.get("priority") ?? ""} onChange={(e) => update("priority", e.target.value)}>
        <option value="">Toda prioridad</option>
        {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
      <select className="field max-w-48" value={params.get("assignedToId") ?? ""} onChange={(e) => update("assignedToId", e.target.value)}>
        <option value="">Todo el personal</option>
        {technicians.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>

      {active.length ? (
        <button
          type="button"
          onClick={() => router.push("/work-orders")}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          <X className="h-3 w-3" /> Limpiar
        </button>
      ) : null}

      <a
        href={`/api/export/work-orders?${params.toString()}`}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
      >
        <Download className="h-3.5 w-3.5" /> Exportar CSV
      </a>
    </div>
  );
}
