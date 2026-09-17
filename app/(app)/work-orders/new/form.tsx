"use client";

import { useZona } from "@/components/zona-empresa";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui";
import { SelectorBuscable } from "@/components/selector-buscable";
import { SelectCatalogo, type OpcionCatalogo } from "@/components/select-catalogo";
import { MAINTENANCE_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/constants";
import { claveDia } from "@/lib/utils";
import { CampoTitulo } from "@/components/campo-titulo";

type Option = { id: string; name: string; code?: string };

export function NewWorkOrderForm({
  assets,
  technicians,
  teams,
  puedeGestionarCatalogos = false,
}: {
  assets: Array<{ id: string; code: string; name: string; criticality: string }>;
  technicians: Option[];
  teams: Option[];
  puedeGestionarCatalogos?: boolean;
}) {
  const zona = useZona();
  const router = useRouter();
  const [opcionesCuadrillas, setOpcionesCuadrillas] = useState<OpcionCatalogo[]>(
    teams.map((t) => ({ id: t.id, etiqueta: t.name })),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<string[]>([]);
  const [form, setForm] = useState({
    title: "",
    description: "",
    maintenanceType: "CORRECTIVE",
    priority: "MEDIUM",
    assetId: "",
    assignedToId: "",
    teamId: "",
    dueDate: claveDia(new Date(Date.now() + 3 * 86_400_000), zona),
    scheduledStart: "",
    estimatedHours: "2",
    requiresShutdown: false,
    procedure: "",
    safetyNotes: "",
  });

  function set(key: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/work-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        estimatedHours: Number(form.estimatedHours),
        assetId: form.assetId || null,
        assignedToId: form.assignedToId || null,
        teamId: form.teamId || null,
        scheduledStart: form.scheduledStart || null,
        tasks: tasks.filter(Boolean).map((title) => ({ title, taskType: "CHECK", required: true })),
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No fue posible crear la orden");
      return;
    }
    router.push(`/work-orders/${data.workOrder.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-3">
      <div className="grid gap-4 lg:col-span-2">
        <Card>
          <CardHeader title="Datos generales" />
          <div className="grid gap-4">
            <div>
              <label className="label">Título del trabajo</label>
              <CampoTitulo value={form.title} onChange={(v) => set("title", v)} required minLength={3} placeholder="Ej. Cambio de rodamiento en bomba P-101" />
            </div>
            <div>
              <label className="label">Descripción / síntoma reportado</label>
              <textarea className="field min-h-24" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Tipo de mantenimiento</label>
                <select className="field" value={form.maintenanceType} onChange={(e) => set("maintenanceType", e.target.value)}>
                  {Object.entries(MAINTENANCE_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Prioridad</label>
                <select className="field" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Activo</label>
              <SelectorBuscable
                valor={form.assetId}
                onCambio={(id) => set("assetId", id)}
                vacio="Sin activo asociado"
                marcador="Busque por clave o nombre del equipo"
                opciones={assets.map((asset) => ({
                  id: asset.id,
                  etiqueta: `${asset.code} — ${asset.name}`,
                  detalle: `Criticidad ${asset.criticality}`,
                }))}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Lista de verificación"
            subtitle="Tareas que el técnico debera completar antes de cerrar la orden"
            action={
              <Button type="button" variant="secondary" size="sm" onClick={() => setTasks((t) => [...t, ""])}>
                <Plus className="h-3.5 w-3.5" /> Agregar
              </Button>
            }
          />
          {tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
              Sin tareas. Opcional para trabajos correctivos simples.
            </p>
          ) : (
            <div className="grid gap-2">
              {tasks.map((task, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-6 text-center text-xs text-slate-400">{index + 1}</span>
                  <input
                    className="field"
                    value={task}
                    placeholder="Ej. Verificar alineación y torque de tornilleria"
                    onChange={(e) =>
                      setTasks((prev) => prev.map((t, i) => (i === index ? e.target.value : t)))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setTasks((prev) => prev.filter((_, i) => i !== index))}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Procedimiento y seguridad" />
          <div className="grid gap-4">
            <div>
              <label className="label">Procedimiento</label>
              <textarea className="field min-h-20" value={form.procedure} onChange={(e) => set("procedure", e.target.value)} placeholder="Pasos, herramienta especial, torques…" />
            </div>
            <div>
              <label className="label">Notas de seguridad (LOTO, EPP)</label>
              <textarea className="field min-h-20" value={form.safetyNotes} onChange={(e) => set("safetyNotes", e.target.value)} placeholder="Bloqueo y etiquetado, permisos requeridos…" />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader title="Programacion" />
          <div className="grid gap-4">
            <div>
              <label className="label">Fecha compromiso</label>
              <input type="date" className="field" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </div>
            <div>
              <label className="label">Inicio programado</label>
              <input type="date" className="field" value={form.scheduledStart} onChange={(e) => set("scheduledStart", e.target.value)} />
            </div>
            <div>
              <label className="label">Horas estimadas</label>
              <input type="number" step="0.5" min="0" className="field" value={form.estimatedHours} onChange={(e) => set("estimatedHours", e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.requiresShutdown} onChange={(e) => set("requiresShutdown", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              Requiere paro del equipo
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader title="Asignacion" />
          <div className="grid gap-4">
            <div>
              <label className="label">Responsable</label>
              <select className="field" value={form.assignedToId} onChange={(e) => set("assignedToId", e.target.value)}>
                <option value="">Sin asignar</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <SelectCatalogo
              catalogo="teams"
              etiqueta="Cuadrilla"
              valor={form.teamId}
              onChange={(v) => set("teamId", v)}
              opciones={opcionesCuadrillas}
              onOpcionesChange={setOpcionesCuadrillas}
              puedeCrear={puedeGestionarCatalogos}
              vacioTexto="Sin cuadrilla"
              camposAlta={[
                { nombre: "name", etiqueta: "Nombre de la cuadrilla", requerido: true },
                { nombre: "description", etiqueta: "Descripción" },
              ]}
            />
          </div>
        </Card>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Crear orden
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancelar
          </Button>
        </div>
      </div>
    </form>
  );
}
