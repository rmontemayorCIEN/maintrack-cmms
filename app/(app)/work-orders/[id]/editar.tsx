"use client";

import { useZona } from "@/components/zona-empresa";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui";
import { MAINTENANCE_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/constants";
import { claveDia } from "@/lib/utils";
import { SelectorBuscable } from "@/components/selector-buscable";

export type OrdenEditable = {
  id: string;
  title: string;
  description: string | null;
  maintenanceType: string;
  priority: string;
  assignedToId: string | null;
  teamId: string | null;
  assetId: string | null;
  dueDate: string | null;
  scheduledStart: string | null;
  estimatedHours: number;
  requiresShutdown: boolean;
  procedure: string | null;
  safetyNotes: string | null;
};

// El dia que representa, no el recorte UTC del texto (ver claveDia).
const fecha = (iso: string | null, zona: string) => (iso ? claveDia(iso, zona) : "");

/**
 * Edicion de la orden.
 *
 * El API ya aceptaba casi todos estos campos; lo que faltaba era por donde
 * cambiarlos. Asignar responsable era el caso mas comun y no habia forma.
 */
export function EditarOrden({
  orden, tecnicos, cuadrillas, activos, editable,
}: {
  orden: OrdenEditable;
  tecnicos: { id: string; name: string }[];
  cuadrillas: { id: string; name: string }[];
  activos: { id: string; code: string; name: string }[];
  editable: boolean;
}) {
  const zona = useZona();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [v, setV] = useState({
    title: orden.title,
    description: orden.description ?? "",
    maintenanceType: orden.maintenanceType,
    priority: orden.priority,
    assignedToId: orden.assignedToId ?? "",
    teamId: orden.teamId ?? "",
    assetId: orden.assetId ?? "",
    dueDate: fecha(orden.dueDate, zona),
    scheduledStart: fecha(orden.scheduledStart, zona),
    estimatedHours: String(orden.estimatedHours),
    requiresShutdown: orden.requiresShutdown,
    procedure: orden.procedure ?? "",
    safetyNotes: orden.safetyNotes ?? "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (c: Partial<typeof v>) => setV((p) => ({ ...p, ...c }));

  if (!editable) return null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(null);
    const res = await fetch(`/api/work-orders/${orden.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: v.title,
        description: v.description || null,
        maintenanceType: v.maintenanceType,
        priority: v.priority,
        assignedToId: v.assignedToId || null,
        teamId: v.teamId || null,
        assetId: v.assetId || null,
        dueDate: v.dueDate || null,
        scheduledStart: v.scheduledStart || null,
        estimatedHours: Number(v.estimatedHours) || 0,
        requiresShutdown: v.requiresShutdown,
        procedure: v.procedure || null,
        safetyNotes: v.safetyNotes || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) { setError(data.error ?? "No fue posible guardar"); return; }
    setAbierto(false);
    router.refresh();
  }

  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setAbierto(true)}>
        <Pencil className="h-3.5 w-3.5" /> Editar
      </Button>

      {abierto ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 text-left">
          <form onSubmit={guardar} className="mt-8 w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-800">Editar orden</h2>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-[0.6875rem] font-medium text-slate-600">Título *</label>
                <input value={v.title} onChange={(e) => set({ title: e.target.value })} required minLength={3}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
              </div>

              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Responsable</label>
                <select value={v.assignedToId} onChange={(e) => set({ assignedToId: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  <option value="">Sin asignar</option>
                  {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <p className="mt-0.5 text-[0.625rem] text-slate-400">
                  Al asignar, una orden abierta pasa a «asignada» sola.
                </p>
              </div>

              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Cuadrilla</label>
                <select value={v.teamId} onChange={(e) => set({ teamId: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  <option value="">Sin cuadrilla</option>
                  {cuadrillas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Tipo</label>
                <select value={v.maintenanceType} onChange={(e) => set({ maintenanceType: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  {Object.entries(MAINTENANCE_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Prioridad</label>
                <select value={v.priority} onChange={(e) => set({ priority: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                  {Object.entries(PRIORITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-[0.6875rem] font-medium text-slate-600">Activo</label>
                <SelectorBuscable
                  className="mt-0.5"
                  valor={v.assetId}
                  onCambio={(id) => set({ assetId: id })}
                  vacio="Sin activo"
                  marcador="Busque por clave o nombre del equipo"
                  opciones={activos.map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}` }))}
                />
                <p className="mt-0.5 text-[0.625rem] text-slate-400">
                  Cambiarlo arrastra también el sitio y la ubicación del equipo.
                </p>
              </div>

              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Vencimiento</label>
                <input type="date" value={v.dueDate} onChange={(e) => set({ dueDate: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
              </div>

              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Inicio programado</label>
                <input type="date" value={v.scheduledStart} onChange={(e) => set({ scheduledStart: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
              </div>

              <div>
                <label className="text-[0.6875rem] font-medium text-slate-600">Horas estimadas</label>
                <input type="number" min="0" step="any" value={v.estimatedHours}
                  onChange={(e) => set({ estimatedHours: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs tabular-nums" />
              </div>

              <label className="flex items-center gap-2 self-end pb-1 text-xs text-slate-700">
                <input type="checkbox" checked={v.requiresShutdown}
                  onChange={(e) => set({ requiresShutdown: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-slate-300" />
                Requiere paro del equipo
              </label>

              <div className="sm:col-span-2">
                <label className="text-[0.6875rem] font-medium text-slate-600">Descripción</label>
                <textarea value={v.description} onChange={(e) => set({ description: e.target.value })} rows={2}
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[0.6875rem] font-medium text-slate-600">Procedimiento</label>
                <textarea value={v.procedure} onChange={(e) => set({ procedure: e.target.value })} rows={2}
                  placeholder="Cómo se hace el trabajo, paso a paso"
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[0.6875rem] font-medium text-slate-600">Notas de seguridad</label>
                <textarea value={v.safetyNotes} onChange={(e) => set({ safetyNotes: e.target.value })} rows={2}
                  placeholder="Bloqueo y etiquetado, equipo de protección, permisos"
                  className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
              </div>
            </div>

            {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>Cancelar</Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Guardar
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
