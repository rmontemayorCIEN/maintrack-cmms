"use client";

import { useMemo, useState } from "react";
import { derivarCadencia } from "@/lib/frecuencias";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button, BotonEditar } from "@/components/ui";
import { PRIORITY_LABELS } from "@/lib/constants";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { RecursosTarea, type LineaMO, type LineaRef, type LineaSrv, type Opcion } from "./recursos-tarea";
import { SelectorBuscable } from "@/components/selector-buscable";

export type Task = {
  title: string;
  taskType: string;
  unit?: string;
  minValue?: string;
  maxValue?: string;
  required: boolean;
  labor: LineaMO[];
  parts: LineaRef[];
  services: LineaSrv[];
  /**
   * Cada cuantos dias se hace ESTA actividad. Vacio = la del plan.
   *
   * El usuario piensa en dias; el programador necesita multiplos de una
   * cadencia base. La traduccion vive en lib/frecuencias.ts y se hace al
   * guardar, no aqui.
   */
  cadaDias?: string;
};

/** Un plan ya guardado, tal como lo manda la pagina para editarlo. */
export type PlanExistente = {
  id: string;
  name: string;
  description: string | null;
  assetId: string | null;
  maintenanceType: string;
  triggerType: string;
  intervalDays: number | null;
  intervalMeter: number | null;
  meterId: string | null;
  leadTimeDays: number;
  priority: string;
  estimatedHours: number;
  assignedToId: string | null;
  requiresShutdown: boolean;
  safetyNotes: string | null;
  nextDueDate: string | null;
  tasks: Task[];
};

const vacia = (t: Partial<Task>): Task => ({
  title: "", taskType: "CHECK", required: true, labor: [], parts: [], services: [], ...t,
});

const PRESETS: Record<string, { intervalDays: number; tasks: Task[] }> = {
  "Lubricación mensual": {
    intervalDays: 30,
    tasks: [
      vacia({ title: "Inspeccionar nivel y estado del lubricante" }),
      vacia({ title: "Aplicar grasa según especificación" }),
      vacia({ title: "Registrar temperatura de chumacera", taskType: "MEASURE", unit: "°C", maxValue: "70" }),
      vacia({ title: "Observaciones", taskType: "TEXT", required: false }),
    ],
  },
  "Inspección electrica trimestral": {
    intervalDays: 90,
    tasks: [
      vacia({ title: "Verificar apriete de conexiones (LOTO aplicado)" }),
      vacia({ title: "Medir corriente por fase", taskType: "MEASURE", unit: "A" }),
      vacia({ title: "Termografia de tablero" }),
      vacia({ title: "Limpieza de gabinete" }),
    ],
  },
  "Servicio mayor anual": {
    intervalDays: 365,
    tasks: [
      vacia({ title: "Desmontaje e inspección de componentes" }),
      vacia({ title: "Cambio de rodamientos y sellos", taskType: "REPLACE" }),
      vacia({ title: "Alineación laser", taskType: "MEASURE", unit: "mm", maxValue: "0.05" }),
      vacia({ title: "Prueba de operación y registro de vibración", taskType: "MEASURE", unit: "mm/s", maxValue: "4.5" }),
    ],
  },
};

export function PlanDialog({
  assets,
  meters,
  technicians,
  especialidades,
  refacciones,
  servicios,
  moneda,
  puedeCrearCatalogos,
  plan,
  borrador,
  aviso,
  onCerrar,
  disparador,
}: {
  assets: Array<{ id: string; code: string; name: string }>;
  meters: Array<{ id: string; name: string; unit: string; assetId: string; currentValue: number }>;
  technicians: Array<{ id: string; name: string }>;
  especialidades: Opcion[];
  refacciones: Opcion[];
  servicios: Opcion[];
  moneda: string;
  puedeCrearCatalogos: boolean;
  /** Si viene, el dialogo edita ese plan en lugar de crear uno nuevo. */
  plan?: PlanExistente;
  /**
   * Borrador con el que abrir el formulario ya lleno —hoy lo produce la IA—.
   * Sigue siendo un alta: nada se guarda hasta que alguien revise y confirme.
   */
  borrador?: Omit<PlanExistente, "id" | "assetId" | "intervalMeter" | "meterId" | "leadTimeDays" | "assignedToId" | "nextDueDate"> & {
    assetId: string;
  };
  /** Aviso a mostrar dentro del formulario, ej. lo que la IA no encontro. */
  aviso?: string | null;
  /** Se llama al cerrar, para que quien lo abrio pueda descartar el borrador. */
  onCerrar?: () => void;
  /**
   * Quien abre el dialogo, cuando no debe ser el boton de siempre.
   *
   * En el listado es el nombre del plan: se toca y entra a la ficha, y el
   * renglon carga un control menos.
   */
  disparador?: (abrir: () => void) => React.ReactNode;
}) {
  const router = useRouter();
  const editando = Boolean(plan);
  const inicial = plan ?? borrador;
  // Un borrador abre el formulario de inmediato: se pidio expresamente y no
  // tiene sentido obligar a un clic mas para verlo.
  const [open, setOpen] = useState(Boolean(borrador));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Los catalogos son estado local para que un alta rapida se refleje en todas
  // las actividades del plan sin recargar la pagina.
  const [catEsp, setCatEsp] = useState(especialidades);
  const [catSrv, setCatSrv] = useState(servicios);

  const [tasks, setTasks] = useState<Task[]>(inicial?.tasks ?? []);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: inicial?.name ?? "",
    description: inicial?.description ?? "",
    assetId: inicial?.assetId ?? "",
    maintenanceType: inicial?.maintenanceType ?? "PREVENTIVE",
    triggerType: inicial?.triggerType ?? "CALENDAR",
    intervalDays: inicial?.intervalDays != null ? String(inicial.intervalDays) : "30",
    intervalMeter: plan?.intervalMeter != null ? String(plan.intervalMeter) : "",
    meterId: plan?.meterId ?? "",
    leadTimeDays: String(plan?.leadTimeDays ?? 3),
    priority: inicial?.priority ?? "MEDIUM",
    estimatedHours: String(inicial?.estimatedHours ?? 2),
    assignedToId: plan?.assignedToId ?? "",
    requiresShutdown: inicial?.requiresShutdown ?? false,
    procedure: "",
    safetyNotes: inicial?.safetyNotes ?? "",
    nextDueDate: plan?.nextDueDate ?? new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  });

  const assetMeters = useMemo(
    () => meters.filter((m) => m.assetId === form.assetId),
    [meters, form.assetId],
  );

  /** Costo estimado del plan completo, en vivo mientras se captura. */
  const estimado = useMemo(() => {
    let horas = 0, mo = 0, ref = 0, srv = 0;
    for (const t of tasks) {
      for (const l of t.labor) {
        const h = Number(l.personas || 0) * Number(l.hours || 0);
        horas += h;
        mo += h * (catEsp.find((e) => e.id === l.specialtyId)?.costo ?? 0);
      }
      for (const p of t.parts) {
        ref += Number(p.quantity || 0) * (refacciones.find((r) => r.id === p.partId)?.costo ?? 0);
      }
      for (const s of t.services) {
        srv += Number(s.quantity || 0) * (catSrv.find((x) => x.id === s.serviceId)?.costo ?? 0);
      }
    }
    return { horas, mo, ref, srv, total: mo + ref + srv };
  }, [tasks, catEsp, catSrv, refacciones]);

  /**
   * Que cadencia queda si se guardan estas frecuencias.
   *
   * Se calcula en vivo para poder ENSEÑARLO antes de guardar: si alguien pone
   * una actividad cada 45 dias en un plan mensual, la cadencia baja a 15 y el
   * equipo se visita mas seguido. Eso no puede ser una sorpresa.
   */
  const cadencia = useMemo(() => {
    if (form.triggerType !== "CALENDAR") return null;
    const base = Number(form.intervalDays) || 0;
    if (base < 1) return null;
    const conTitulo = tasks.filter((t) => t.title.trim());
    if (!conTitulo.length) return null;
    const dias = conTitulo.map((t) => Number(t.cadaDias) || base);
    const d = derivarCadencia([{ cadaDias: base }, ...dias.map((x) => ({ cadaDias: x }))]);
    return {
      base: d.base,
      cambia: d.base !== base,
      // Lo que lleva cada visita, hasta la que junta todo.
      actividades: conTitulo.map((t, i) => ({
        titulo: t.title,
        dias: dias[i],
        cadaCuantas: Math.max(Math.round(dias[i] / d.base), 1),
      })),
    };
  }, [tasks, form.triggerType, form.intervalDays]);

  function set(key: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function cambiarTarea(index: number, cambios: Partial<Task>) {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...cambios } : t)));
  }

  function applyPreset(name: string) {
    const preset = PRESETS[name];
    if (!preset) return;
    setForm((prev) => ({ ...prev, name, intervalDays: String(preset.intervalDays), triggerType: "CALENDAR" }));
    setTasks(preset.tasks.map((t) => ({ ...t, labor: [], parts: [], services: [] })));
  }

  function abrir() {
    // Al reabrir, el formulario vuelve a lo que hay guardado: si el usuario
    // cancelo a medias no debe arrastrar cambios a la siguiente vez.
    if (plan) setTasks(plan.tasks);
    // Los catalogos se resincronizan siempre, no solo al editar: si alguien
    // dio de alta una especialidad desde otra pantalla, aqui tiene que estar.
    setCatEsp(especialidades);
    setCatSrv(servicios);
    setError(null);
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const cuerpo = {
      ...form,
      intervalDays: form.triggerType === "CALENDAR" ? Number(form.intervalDays) : null,
      intervalMeter: form.triggerType === "METER" ? Number(form.intervalMeter) : null,
      meterId: form.triggerType === "METER" ? form.meterId : null,
      leadTimeDays: Number(form.leadTimeDays),
      estimatedHours: Number(form.estimatedHours),
      assignedToId: form.assignedToId || null,
      tasks: tasks
        .filter((t) => t.title.trim())
        .map((t) => ({
          title: t.title,
          taskType: t.taskType,
          unit: t.unit || null,
          minValue: t.minValue ? Number(t.minValue) : null,
          maxValue: t.maxValue ? Number(t.maxValue) : null,
          required: t.required,
          cadaDias: Number(t.cadaDias) || null,
          labor: t.labor.filter((l) => l.specialtyId).map((l) => ({
            specialtyId: l.specialtyId,
            personas: Number(l.personas || 1),
            hours: Number(l.hours || 0),
          })),
          parts: t.parts.filter((p) => p.partId).map((p) => ({
            partId: p.partId,
            quantity: Number(p.quantity || 0),
          })),
          services: t.services.filter((s) => s.serviceId).map((s) => ({
            serviceId: s.serviceId,
            quantity: Number(s.quantity || 0),
            nota: s.nota || null,
          })),
        })),
    };

    const res = await fetch(plan ? `/api/plans/${plan.id}` : "/api/plans", {
      method: plan ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok || data.error) {
      setError(data.error ?? `No fue posible ${plan ? "guardar" : "crear"} el plan`);
      return;
    }
    setOpen(false);
    onCerrar?.();
    if (!plan) setTasks([]);
    router.refresh();
  }

  function cerrar() {
    setOpen(false);
    onCerrar?.();
  }

  if (!open) {
    if (disparador) return <>{disparador(abrir)}</>;
    return editando ? (
      <BotonEditar que="plan" onClick={abrir} />
    ) : (
      <Button size="sm" onClick={abrir}>
        <Plus className="h-3.5 w-3.5" /> Nuevo plan
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 p-4 text-left">
      <form onSubmit={submit} className="mx-auto my-6 w-full max-w-4xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {editando ? `Editar plan: ${plan!.name}` : borrador ? "Revise el plan propuesto" : "Nuevo plan de mantenimiento"}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {borrador
                ? "Lo redacto la inteligencia artificial a partir del equipo y su historial. Nada se guarda hasta que usted lo confirme: revise frecuencia, actividades y recursos antes de crearlo."
                : "Define la frecuencia, las actividades y los recursos que cada una requiere. El programador generara la OT con la anticipación indicada."}
            </p>
          </div>
          <button type="button" onClick={cerrar} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {aviso ? (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{aviso}</p>
        ) : null}

        {!editando && !borrador ? (
          <div className="mb-4 flex flex-wrap gap-1.5">
            <span className="self-center text-[0.6875rem] font-medium text-slate-500">Plantillas:</span>
            {Object.keys(PRESETS).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                className="rounded-full border border-slate-200 px-2.5 py-1 text-[0.6875rem] text-slate-600 hover:border-brand-300 hover:bg-brand-50"
              >
                {preset}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="label">Nombre del plan</label>
            <input className="field" value={form.name} onChange={(e) => set("name", e.target.value)} required minLength={3} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Descripción</label>
            <input className="field" value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div>
            <label className="label">Asignar a un equipo</label>
            <SelectorBuscable
              valor={form.assetId}
              onCambio={(id) => set("assetId", id)}
              vacio="Solo al catálogo, sin asignar todavía"
              marcador="Busque por clave o nombre del equipo"
              opciones={assets.map((a) => ({ id: a.id, etiqueta: `${a.code} — ${a.name}` }))}
            />
            <p className="mt-1 text-[0.6875rem] text-slate-500">
              {form.assetId
                ? "El plan queda asignado a ese equipo y empieza a generar órdenes."
                : "El plan queda en el catálogo. Para que genere, asignelo en Equipos y sus planes."}
            </p>
          </div>
          <div>
            <label className="label">Tipo</label>
            <select className="field" value={form.maintenanceType} onChange={(e) => set("maintenanceType", e.target.value)}>
              <option value="PREVENTIVE">Preventivo</option>
              <option value="INSPECTION">Inspección</option>
              <option value="PREDICTIVE">Predictivo (ruta)</option>
            </select>
          </div>
          <div>
            <label className="label">Disparo</label>
            <select className="field" value={form.triggerType} onChange={(e) => set("triggerType", e.target.value)}>
              <option value="CALENDAR">Por calendario</option>
              <option value="METER">Por medidor</option>
            </select>
          </div>
          {form.triggerType === "CALENDAR" ? (
            <div>
              <label className="label">Cada cuantos días</label>
              <input type="number" min="1" className="field" value={form.intervalDays} onChange={(e) => set("intervalDays", e.target.value)} required />
            </div>
          ) : (
            <>
              <div>
                <label className="label">Medidor</label>
                <select className="field" value={form.meterId} onChange={(e) => set("meterId", e.target.value)} required>
                  <option value="">Seleccione…</option>
                  {assetMeters.map((meter) => (
                    <option key={meter.id} value={meter.id}>
                      {meter.name} ({meter.unit}) — actual {meter.currentValue}
                    </option>
                  ))}
                </select>
                {assetMeters.length === 0 ? (
                  <p className="mt-1 text-[0.6875rem] text-amber-600">Este activo no tiene medidores registrados.</p>
                ) : null}
              </div>
              <div>
                <label className="label">Intervalo del medidor</label>
                <input type="number" min="1" className="field" value={form.intervalMeter} onChange={(e) => set("intervalMeter", e.target.value)} required />
              </div>
            </>
          )}
          <div>
            <label className="label">Anticipación (días)</label>
            <input type="number" min="0" className="field" value={form.leadTimeDays} onChange={(e) => set("leadTimeDays", e.target.value)} />
          </div>
          <div>
            <label className="label">Prioridad</label>
            <select className="field" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Horas estimadas</label>
            <input type="number" step="0.5" min="0" className="field" value={form.estimatedHours} onChange={(e) => set("estimatedHours", e.target.value)} />
            {estimado.horas > 0 ? (
              <button
                type="button"
                onClick={() => set("estimatedHours", String(estimado.horas))}
                className="mt-1 text-[0.6875rem] text-brand-600 underline-offset-2 hover:underline"
              >
                Usar {formatNumber(estimado.horas, 1)} h de la mano de obra capturada
              </button>
            ) : null}
          </div>
          <div>
            <label className="label">Responsable sugerido</label>
            <select className="field" value={form.assignedToId} onChange={(e) => set("assignedToId", e.target.value)}>
              <option value="">Sin asignar</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{editando ? "Proximo vencimiento" : "Primer vencimiento"}</label>
            <input type="date" className="field" value={form.nextDueDate} onChange={(e) => set("nextDueDate", e.target.value)} />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.requiresShutdown} onChange={(e) => set("requiresShutdown", e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Requiere paro del equipo
          </label>
          <div className="md:col-span-2">
            <label className="label">Notas de seguridad</label>
            <input className="field" value={form.safetyNotes} onChange={(e) => set("safetyNotes", e.target.value)} placeholder="LOTO, permisos, EPP requerido…" />
          </div>
        </div>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">Actividades y recursos</p>
              <p className="text-[0.6875rem] text-slate-500">
                Cada actividad puede llevar su propia frecuencia, mano de obra, refacciones y
                servicios. En blanco, la frecuencia es la del plan.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setTasks((t) => [...t, vacia({})]);
                setAbierta(tasks.length);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Agregar actividad
            </Button>
          </div>

          {tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 py-5 text-center text-xs text-slate-400">
              {editando ? "Este plan no tiene actividades." : "Use una plantilla o agregue actividades manualmente."}
            </p>
          ) : (
            <div className="grid gap-2">
              {/*
                Lo que va a pasar, ANTES de guardar.

                Poner una actividad cada 45 dias en un plan mensual baja la
                cadencia a 15 y el equipo se visita mas seguido. Eso no puede
                ser una sorpresa que alguien descubra en la bandeja de ordenes.
              */}
              {cadencia && cadencia.actividades.some((a) => a.cadaCuantas > 1) ? (
                <div className="mb-2 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2 text-[0.6875rem] leading-relaxed text-slate-700">
                  {cadencia.cambia ? (
                    <p className="mb-1 font-medium text-amber-800">
                      Con estas frecuencias, el equipo se visita cada {cadencia.base} días —no cada{" "}
                      {form.intervalDays}—, porque es el ritmo que las hace encajar todas.
                    </p>
                  ) : (
                    <p className="mb-1 font-medium">
                      El equipo se visita cada {cadencia.base} días. En cada visita entra:
                    </p>
                  )}
                  <ul className="grid gap-0.5">
                    {cadencia.actividades.map((a, i) => (
                      <li key={i} className="flex flex-wrap gap-x-1.5">
                        <span className="font-mono text-slate-500">
                          {a.cadaCuantas === 1 ? "cada visita" : `1 de cada ${a.cadaCuantas}`}
                        </span>
                        <span>· {a.titulo || "(sin nombre)"}</span>
                        <span className="text-slate-500">— cada {a.dias} días</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-slate-500">
                    Las visitas donde coinciden varias salen en <strong>una sola orden</strong>: el
                    técnico va una vez y hace todo lo que toca.
                  </p>
                </div>
              ) : null}

              {tasks.map((task, index) => {
                const recursos = task.labor.length + task.parts.length + task.services.length;
                const desplegada = abierta === index;
                return (
                  <div key={index} className="rounded-lg border border-slate-200 p-2">
                    <div className="grid gap-2 md:grid-cols-[1fr_130px_92px_80px_80px_80px_32px]">
                      <input
                        className="field"
                        placeholder="Descripción de la actividad"
                        value={task.title}
                        onChange={(e) => cambiarTarea(index, { title: e.target.value })}
                      />
                      <select
                        className="field"
                        value={task.taskType}
                        onChange={(e) => cambiarTarea(index, { taskType: e.target.value })}
                      >
                        <option value="CHECK">Verificación</option>
                        <option value="MEASURE">Medición</option>
                        <option value="TEXT">Texto</option>
                        <option value="REPLACE">Reemplazo</option>
                      </select>
                      {/*
                        Cada cuantos DIAS, no cada cuantas ejecuciones: nadie
                        piensa en multiplos. La traduccion se hace al guardar.
                        Vacio hereda la frecuencia del plan, que es el caso de
                        siempre y por eso es lo que no hay que capturar.
                      */}
                      <input
                        className="field"
                        placeholder={form.triggerType === "CALENDAR" ? `cada ${form.intervalDays || "?"} d` : "cada"}
                        title="Cada cuántos días se hace esta actividad. Vacío: la frecuencia del plan."
                        inputMode="numeric"
                        value={task.cadaDias ?? ""}
                        onChange={(e) => cambiarTarea(index, { cadaDias: e.target.value.replace(/[^0-9]/g, "") })}
                      />
                      <input
                        className="field" placeholder="Unidad"
                        value={task.unit ?? ""}
                        onChange={(e) => cambiarTarea(index, { unit: e.target.value })}
                      />
                      <input
                        className="field" placeholder="Min"
                        value={task.minValue ?? ""}
                        onChange={(e) => cambiarTarea(index, { minValue: e.target.value })}
                      />
                      <input
                        className="field" placeholder="Max"
                        value={task.maxValue ?? ""}
                        onChange={(e) => cambiarTarea(index, { maxValue: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setTasks((prev) => prev.filter((_, i) => i !== index));
                          setAbierta(null);
                        }}
                        className="grid h-9 w-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setAbierta(desplegada ? null : index)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-slate-500 hover:text-brand-600"
                    >
                      {desplegada ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      Recursos requeridos
                      {recursos ? (
                        <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[0.625rem] font-semibold text-brand-700">
                          {recursos}
                        </span>
                      ) : null}
                    </button>

                    {desplegada ? (
                      <div className="mt-2">
                        <RecursosTarea
                          labor={task.labor}
                          parts={task.parts}
                          services={task.services}
                          especialidades={catEsp}
                          refacciones={refacciones}
                          servicios={catSrv}
                          moneda={moneda}
                          puedeCrear={puedeCrearCatalogos}
                          onLabor={(v) => cambiarTarea(index, { labor: v })}
                          onParts={(v) => cambiarTarea(index, { parts: v })}
                          onServices={(v) => cambiarTarea(index, { services: v })}
                          onEspecialidades={setCatEsp}
                          onServicios={setCatSrv}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {estimado.total > 0 || estimado.horas > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>
                Costo estimado por ejecucion · MO {formatCurrency(estimado.mo, moneda)} ·
                Refacciones {formatCurrency(estimado.ref, moneda)} ·
                Servicios {formatCurrency(estimado.srv, moneda)}
              </span>
              <span className="font-semibold text-slate-900">
                {formatNumber(estimado.horas, 1)} h · {formatCurrency(estimado.total, moneda)}
              </span>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cerrar}>Cancelar</Button>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {editando ? "Guardar cambios" : borrador ? "Crear este plan" : "Crear plan"}
          </Button>
        </div>
      </form>
    </div>
  );
}
