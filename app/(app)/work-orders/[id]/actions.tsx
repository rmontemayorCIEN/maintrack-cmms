"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Pause, Play, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { SelectCatalogo, type OpcionCatalogo } from "@/components/select-catalogo";
import { STATUS_TRANSITIONS, WO_STATUS_LABELS } from "@/lib/constants";

export function WorkOrderActions({
  workOrderId,
  status,
  failureCodes,
  causasRaiz,
  pendingRequired,
  puedeGestionarCatalogos = false,
  iaDisponible = false,
}: {
  workOrderId: string;
  status: string;
  failureCodes: Array<{ id: string; code: string; description: string }>;
  causasRaiz: Array<{ id: string; code: string; description: string }>;
  pendingRequired: number;
  puedeGestionarCatalogos?: boolean;
  /** Si el plan de la empresa incluye el asistente de cierre. */
  iaDisponible?: boolean;
}) {
  const router = useRouter();
  const [opcionesFallas, setOpcionesFallas] = useState<OpcionCatalogo[]>(
    failureCodes.map((c) => ({ id: c.id, etiqueta: `${c.code} — ${c.description}` })),
  );
  const [opcionesCausas, setOpcionesCausas] = useState<OpcionCatalogo[]>(
    causasRaiz.map((c) => ({ id: c.id, etiqueta: `${c.code} — ${c.description}` })),
  );
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeForm, setCloseForm] = useState({
    resolution: "",
    rootCauseId: "",
    failureCodeId: "",
    downtimeMinutes: "0",
  });

  type Sugerencia = {
    failureCodeId: string | null; failureCodeEtiqueta: string | null;
    rootCauseId: string | null; rootCauseEtiqueta: string | null;
    refacciones: Array<{ partId: string; codigo: string; nombre: string; unidad: string; cantidad: number; motivo: string; existencia: number }>;
    confianza: "ALTA" | "MEDIA" | "BAJA";
    nota: string;
  };
  const [sugiriendo, setSugiriendo] = useState(false);
  const [sugerencia, setSugerencia] = useState<Sugerencia | null>(null);
  const [errorIa, setErrorIa] = useState<string | null>(null);
  const [cargandoRefaccion, setCargandoRefaccion] = useState<string | null>(null);
  const [refaccionesCargadas, setRefaccionesCargadas] = useState<string[]>([]);

  /**
   * La sugerencia rellena los campos vacios pero nunca pisa lo que el tecnico
   * ya eligio: si el capturo algo, su criterio manda sobre el del modelo.
   */
  async function sugerir() {
    setSugiriendo(true);
    setErrorIa(null);
    const res = await fetch("/api/ia/cierre", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workOrderId, texto: closeForm.resolution }),
    });
    const data = await res.json();
    setSugiriendo(false);
    if (!res.ok) { setErrorIa(data.error ?? "No fue posible generar la sugerencia"); return; }

    const s: Sugerencia = data.sugerencia;
    setSugerencia(s);
    setCloseForm((f) => ({
      ...f,
      failureCodeId: f.failureCodeId || (s.failureCodeId ?? ""),
      rootCauseId: f.rootCauseId || (s.rootCauseId ?? ""),
    }));
  }

  async function cargarRefaccion(partId: string, quantity: number) {
    setCargandoRefaccion(partId);
    const res = await fetch(`/api/work-orders/${workOrderId}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId, quantity }),
    });
    setCargandoRefaccion(null);
    if (!res.ok) {
      const data = await res.json();
      setErrorIa(data.error ?? "No fue posible cargar la refaccion");
      return;
    }
    setRefaccionesCargadas((prev) => [...prev, partId]);
    router.refresh();
  }

  const allowed = STATUS_TRANSITIONS[status] ?? [];

  async function move(next: string, extra?: Record<string, unknown>) {
    setLoading(next);
    setError(null);
    const res = await fetch(`/api/work-orders/${workOrderId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, ...extra }),
    });
    const data = await res.json();
    setLoading(null);
    if (!res.ok) {
      setError(data.error ?? "No fue posible cambiar el estado");
      return;
    }
    setClosing(false);
    router.refresh();
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {allowed.includes("IN_PROGRESS") ? (
        <Button size="sm" onClick={() => move("IN_PROGRESS")} disabled={loading !== null}>
          {loading === "IN_PROGRESS" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Iniciar
        </Button>
      ) : null}

      {allowed.includes("ON_HOLD") ? (
        <Button size="sm" variant="secondary" onClick={() => move("ON_HOLD")} disabled={loading !== null}>
          <Pause className="h-3.5 w-3.5" /> Pausar
        </Button>
      ) : null}

      {allowed.includes("COMPLETED") ? (
        <Button size="sm" variant="success" onClick={() => setClosing(true)} disabled={loading !== null}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Completar
        </Button>
      ) : null}

      {allowed.includes("CLOSED") ? (
        <Button size="sm" variant="success" onClick={() => move("CLOSED")} disabled={loading !== null}>
          {loading === "CLOSED" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Cerrar administrativamente
        </Button>
      ) : null}

      {allowed.filter((s) => !["IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED"].includes(s)).map((next) => (
        <Button key={next} size="sm" variant={next === "CANCELLED" ? "danger" : "secondary"} onClick={() => move(next)} disabled={loading !== null}>
          {WO_STATUS_LABELS[next]}
        </Button>
      ))}

      {error ? (
        <p className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{error}</p>
      ) : null}

      {closing ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Cierre tecnico</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Registre el resultado del trabajo para alimentar los indicadores de confiabilidad.
                </p>
              </div>
              <button type="button" onClick={() => setClosing(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            {pendingRequired > 0 ? (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Faltan {pendingRequired} tarea(s) obligatoria(s) de la lista de verificacion.
              </p>
            ) : null}

            <div className="grid gap-4">
              <SelectCatalogo
                catalogo="failure-codes"
                etiqueta="Codigo de falla"
                valor={closeForm.failureCodeId}
                onChange={(v) => setCloseForm((f) => ({ ...f, failureCodeId: v }))}
                opciones={opcionesFallas}
                onOpcionesChange={setOpcionesFallas}
                puedeCrear={puedeGestionarCatalogos}
                vacioTexto="Sin codificar"
                camposAlta={[
                  { nombre: "code", etiqueta: "Codigo (ej. MEC-05)", requerido: true },
                  { nombre: "description", etiqueta: "Descripcion de la falla", requerido: true },
                ]}
                ayuda="Alimenta el analisis de fallas repetidas"
              />
              <SelectCatalogo
                catalogo="root-causes"
                etiqueta="Causa raiz"
                valor={closeForm.rootCauseId}
                onChange={(v) => setCloseForm((f) => ({ ...f, rootCauseId: v }))}
                opciones={opcionesCausas}
                onOpcionesChange={setOpcionesCausas}
                puedeCrear={puedeGestionarCatalogos}
                vacioTexto="Sin determinar"
                camposAlta={[
                  { nombre: "code", etiqueta: "Codigo (ej. FILTRO-SATURADO)", requerido: true },
                  { nombre: "description", etiqueta: "Por que fallo", requerido: true },
                ]}
                ayuda="Por que fallo, no que fallo. Es lo que permite atacar el patron."
              />
              <div>
                <div className="mb-1 flex items-end justify-between gap-2">
                  <label className="label mb-0">Solucion aplicada</label>
                  {iaDisponible ? (
                    <button
                      type="button"
                      onClick={sugerir}
                      disabled={sugiriendo || closeForm.resolution.trim().length < 10}
                      title={
                        closeForm.resolution.trim().length < 10
                          ? "Escriba primero que hizo, aunque sea en pocas palabras"
                          : "La IA propone codigo de falla, causa raiz y refacciones"
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[0.6875rem] font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
                    >
                      {sugiriendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      {sugiriendo ? "Analizando…" : "Codificar con IA"}
                    </button>
                  ) : null}
                </div>
                <textarea
                  className="field min-h-20"
                  placeholder="Que encontro y que hizo. Con dos renglones basta."
                  value={closeForm.resolution}
                  onChange={(e) => setCloseForm((f) => ({ ...f, resolution: e.target.value }))}
                />
                {errorIa ? <p className="mt-1 text-[0.6875rem] text-red-600">{errorIa}</p> : null}

                {sugerencia ? (
                  <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/60 p-2.5">
                    <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-brand-700">
                      <Sparkles className="h-3 w-3" /> Sugerencia
                      <span className={`rounded-full px-1.5 py-0.5 text-[0.625rem] normal-case tracking-normal ${
                        sugerencia.confianza === "ALTA" ? "bg-emerald-100 text-emerald-700"
                          : sugerencia.confianza === "MEDIA" ? "bg-amber-100 text-amber-800"
                          : "bg-slate-200 text-slate-600"
                      }`}>
                        confianza {sugerencia.confianza.toLowerCase()}
                      </span>
                    </p>
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-brand-900/80">{sugerencia.nota}</p>

                    {!sugerencia.failureCodeId && !sugerencia.rootCauseId ? (
                      <p className="mt-1.5 text-[0.6875rem] text-brand-900/70">
                        No encontro elementos suficientes para codificar. Amplie un poco lo que escribio y
                        vuelva a intentar, o codifique a mano.
                      </p>
                    ) : null}

                    {sugerencia.refacciones.length ? (
                      <div className="mt-2 grid gap-1">
                        <p className="text-[0.6875rem] font-medium text-brand-900">Refacciones que sugiere cargar:</p>
                        {sugerencia.refacciones.map((r) => {
                          const cargada = refaccionesCargadas.includes(r.partId);
                          const sinExistencia = r.existencia < r.cantidad;
                          return (
                            <div key={r.partId} className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2 py-1">
                              <div className="min-w-0">
                                <p className="truncate text-[0.6875rem] font-medium text-slate-700">
                                  {r.codigo} — {r.nombre} × {r.cantidad} {r.unidad}
                                </p>
                                <p className="truncate text-[0.625rem] text-slate-500">{r.motivo}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => cargarRefaccion(r.partId, r.cantidad)}
                                disabled={cargada || sinExistencia || cargandoRefaccion === r.partId}
                                className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[0.625rem] font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40"
                              >
                                {cargandoRefaccion === r.partId ? "…"
                                  : cargada ? "Cargada"
                                  : sinExistencia ? `Solo ${r.existencia} en almacen`
                                  : "Cargar"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <p className="mt-1.5 text-[0.625rem] text-brand-900/60">
                      Revise antes de completar: de estos datos salen los indicadores de confiabilidad.
                    </p>
                  </div>
                ) : null}
              </div>
              <div>
                <label className="label">Tiempo de paro del equipo (minutos)</label>
                <input
                  type="number"
                  min="0"
                  className="field"
                  value={closeForm.downtimeMinutes}
                  onChange={(e) => setCloseForm((f) => ({ ...f, downtimeMinutes: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setClosing(false)}>Cancelar</Button>
              <Button
                variant="success"
                disabled={loading !== null}
                onClick={() =>
                  move("COMPLETED", {
                    resolution: closeForm.resolution || undefined,
                    rootCauseId: closeForm.rootCauseId || null,
                    failureCodeId: closeForm.failureCodeId || null,
                    downtimeMinutes: Number(closeForm.downtimeMinutes) || 0,
                  })
                }
              >
                {loading === "COMPLETED" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Completar orden
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
