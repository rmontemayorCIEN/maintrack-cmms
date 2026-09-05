"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Avatar, Button } from "@/components/ui";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { SelectActividad, type ActividadCargable } from "@/components/select-actividad";

export function LaborPanel({
  actividades,
  workOrderId,
  entries,
  technicians,
  currentUserId,
  currency,
  editable,
}: {
  workOrderId: string;
  /** Las actividades de la orden, para cargarle el gasto a una. */
  actividades: ActividadCargable[];
  entries: Array<{ id: string; name: string; color: string; hours: number; cost: number; workedAt: string; notes: string | null }>;
  technicians: Array<{ id: string; name: string; hourlyRate: number }>;
  currentUserId: string;
  currency: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState(currentUserId);
  const [hours, setHours] = useState("1");
  const [notes, setNotes] = useState("");
  const [taskId, setTaskId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/work-orders/${workOrderId}/labor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, hours: Number(hours), notes: notes || undefined, taskId: taskId || null }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "No fue posible registrar la mano de obra");
      return;
    }
    setHours("1");
    setNotes("");
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">
          Sin horas registradas
        </p>
      ) : (
        <ul className="grid gap-2">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2">
              <Avatar name={entry.name} color={entry.color} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-700">{entry.name}</p>
                <p className="text-[0.6875rem] text-slate-400">
                  {formatDate(entry.workedAt)}
                  {entry.notes ? ` · ${entry.notes}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium tabular-nums text-slate-700">{formatNumber(entry.hours, 1)} h</p>
                <p className="text-[0.6875rem] tabular-nums text-slate-400">{formatCurrency(entry.cost, currency)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
          <select className="field" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {formatCurrency(t.hourlyRate, currency)}/h
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              type="number"
              step="0.25"
              min="0.25"
              className="field max-w-24"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="Horas"
            />
            <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Actividad realizada" />
            <Button size="sm" onClick={add} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <SelectActividad actividades={actividades} valor={taskId} onChange={setTaskId} />
          {error ? <p className="text-[0.6875rem] text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
