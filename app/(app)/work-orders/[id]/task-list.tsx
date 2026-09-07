"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, ChevronUp, PackageX, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ORIGENES, ORDEN_DE_GRUPOS, TONOS, origenValido, type ClaveOrigen } from "@/lib/origenes-actividad";
import { MOTIVOS_LIBERACION } from "@/lib/backlog";
import { SelectorBuscable } from "@/components/selector-buscable";

type Task = {
  id: string;
  title: string;
  description: string | null;
  taskType: string;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  required: boolean;
  done: boolean;
  resultNumber: number | null;
  resultText: string | null;
  passed: boolean | null;
  liberadaAt: string | Date | null;
  motivoLiberacion: string | null;
  motivoDetalle: string | null;
  bloqueadaPorPartId: string | null;
  /** De donde vino: PLAN | SOLICITUD | IA | BACKLOG | ALERTA | MANUAL. */
  origen: string;
  /** El folio del reporte que la origino, si vino de uno. */
  solicitud: string | null;
};

type Refaccion = { id: string; code: string; name: string };

export function TaskList({
  workOrderId,
  tasks,
  editable,
  refacciones = [],
}: {
  workOrderId: string;
  tasks: Task[];
  editable: boolean;
  refacciones?: Refaccion[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [liberando, setLiberando] = useState<Task | null>(null);
  const [motivo, setMotivo] = useState<string>("SIN_REFACCION");
  const [detalle, setDetalle] = useState("");
  const [partId, setPartId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [plegados, setPlegados] = useState<Record<string, boolean>>({});

  /**
   * Las actividades agrupadas por origen.
   *
   * Se guarda el indice ORIGINAL de cada una: la numeracion que ve el tecnico
   * —1, 2, 3…— es la del papel impreso y la que menciona por radio, asi que no
   * puede cambiar solo porque la pantalla las reagrupe.
   */
  const grupos = useMemo(() => {
    /**
     * Los grupos son TRAMOS CONTIGUOS del mismo origen, no una bolsa por
     * origen.
     *
     * Asi la numeracion siempre asciende, aunque el gestor reordene. Si decide
     * «tres pasos del plan, luego atender la fuga, luego el resto del plan»,
     * la pantalla muestra exactamente eso —y «Del plan preventivo» aparece dos
     * veces. No es un defecto: es la secuencia que el eligio.
     */
    const tramos: Array<{ clave: ClaveOrigen; items: Array<{ task: Task; indice: number }> }> = [];
    tasks.forEach((task, i) => {
      const clave = origenValido(task.origen);
      const ultimo = tramos[tramos.length - 1];
      if (ultimo && ultimo.clave === clave) ultimo.items.push({ task, indice: i });
      else tramos.push({ clave, items: [{ task, indice: i }] });
    });
    return tramos.map((t, n) => ({ ...t, id: `${t.clave}-${n}`, ...ORIGENES[t.clave] }));
  }, [tasks]);

  /** Con un solo origen no hay nada que distinguir: va la lista sola. */
  const agrupar = grupos.length > 1;

  /**
   * Mueve una actividad un lugar. El servidor decide si se puede.
   *
   * Se pregunta alla y no aqui porque la regla —no pasar por encima de lo ya
   * resuelto— tiene que valer aunque la peticion venga de otro lado.
   */
  async function mover(task: Task, direccion: "ARRIBA" | "ABAJO") {
    setError(null);
    const res = await fetch(`/api/work-orders/${workOrderId}/tasks/orden`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, direccion }),
    });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "No fue posible mover la actividad");
      return;
    }
    startTransition(() => router.refresh());
  }

  function abrirLiberar(task: Task) {
    setLiberando(task);
    setMotivo("SIN_REFACCION");
    setDetalle("");
    setPartId("");
    setError(null);
  }

  async function confirmarLiberar() {
    if (!liberando) return;
    setGuardando(true);
    setError(null);
    const res = await fetch(`/api/work-orders/${workOrderId}/tasks/liberar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: liberando.id,
        motivo,
        detalle: detalle.trim() || null,
        bloqueadaPorPartId: motivo === "SIN_REFACCION" && partId ? partId : null,
      }),
    });
    setGuardando(false);
    if (!res.ok) {
      const cuerpo = await res.json().catch(() => null);
      setError(cuerpo?.error ?? "No se pudo liberar la actividad.");
      return;
    }
    setLiberando(null);
    startTransition(() => router.refresh());
  }

  async function deshacerLiberar(task: Task) {
    await fetch(`/api/work-orders/${workOrderId}/tasks/liberar`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    startTransition(() => router.refresh());
  }
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(tasks.map((t) => [t.id, t.resultNumber?.toString() ?? t.resultText ?? ""])),
  );

  async function update(task: Task, payload: Record<string, unknown>) {
    await fetch(`/api/work-orders/${workOrderId}/tasks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, ...payload }),
    });
    startTransition(() => router.refresh());
  }

  if (!tasks.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-400">
        Esta orden no tiene lista de verificación.
      </p>
    );
  }

  return (
    <>
      {(agrupar ? grupos : [{ clave: "TODO" as const, id: "TODO", etiqueta: "", ayuda: "", tono: "gris", items: tasks.map((task, indice) => ({ task, indice })) }]).map((g) => {
        const tono = TONOS[g.tono];
        const abierto = !plegados[g.id];
        const hechas = g.items.filter((x) => x.task.done || x.task.liberadaAt).length;
        return (
        <div key={g.id} className={agrupar ? cn("rounded-lg border", tono.borde) : undefined}>
          {agrupar ? (
            <button
              type="button"
              onClick={() => setPlegados((p) => ({ ...p, [g.id]: !p[g.id] }))}
              className={cn("flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left", tono.fondo)}
              aria-expanded={abierto}
            >
              <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", tono.texto, abierto && "rotate-90")} />
              <span className="min-w-0 flex-1">
                <span className={cn("block text-xs font-semibold", tono.texto)}>{g.etiqueta}</span>
                <span className="block text-[0.6875rem] leading-snug text-slate-500">{g.ayuda}</span>
              </span>
              <span className="shrink-0 text-[0.6875rem] tabular-nums text-slate-500">{hechas} de {g.items.length}</span>
            </button>
          ) : null}
          {abierto ? (
          <ul className={cn("grid gap-2", agrupar && "p-2")}>
          {g.items.map(({ task, indice: index }) => (
        <li
          key={task.id}
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3 transition-colors",
            task.liberadaAt
              ? "border-amber-200 bg-amber-50/50"
              : task.done
                ? "border-emerald-200 bg-emerald-50/50"
                : "border-slate-200",
          )}
        >
          <button
            type="button"
            disabled={!editable || !!task.liberadaAt}
            onClick={() => update(task, { done: !task.done })}
            className={cn(
              "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors",
              task.done
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-slate-300 bg-white hover:border-brand-500",
              (!editable || task.liberadaAt) && "cursor-not-allowed opacity-60",
            )}
            aria-label={task.done ? "Marcar pendiente" : "Marcar completada"}
          >
            {task.done ? <Check className="h-3.5 w-3.5" /> : null}
          </button>

          {/* Reordenar: el plan y la IA proponen, el gestor decide. Se ocultan
              en lo ya resuelto, que se queda donde paso. */}
          {editable && !task.done && !task.liberadaAt && tasks.length > 1 ? (
            <span className="mt-0.5 grid shrink-0 gap-0.5">
              <button
                type="button"
                onClick={() => mover(task, "ARRIBA")}
                disabled={index === 0}
                className="grid h-4 w-4 place-items-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:invisible"
                aria-label="Subir un lugar"
                title="Subir un lugar"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => mover(task, "ABAJO")}
                disabled={index === tasks.length - 1}
                className="grid h-4 w-4 place-items-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-600 disabled:invisible"
                aria-label="Bajar un lugar"
                title="Bajar un lugar"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </span>
          ) : null}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">{index + 1}.</span>
              <p className={cn("text-sm font-medium", task.done ? "text-slate-500 line-through" : "text-slate-800")}>
                {task.title}
              </p>
              {task.liberadaAt ? <Badge tone="warning">Liberada</Badge> : null}
              {task.required && !task.liberadaAt ? <Badge tone="muted">Obligatoria</Badge> : null}
              {task.passed === false ? <Badge tone="danger">Fuera de rango</Badge> : null}
              {task.passed === true ? <Badge tone="success">En rango</Badge> : null}
            </div>
            {task.description ? <p className="mt-0.5 text-xs text-slate-500">{task.description}</p> : null}

            {task.liberadaAt ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                <span>
                  No se hizo:{" "}
                  {MOTIVOS_LIBERACION[task.motivoLiberacion as keyof typeof MOTIVOS_LIBERACION] ??
                    task.motivoLiberacion}
                  {task.motivoDetalle ? ` — ${task.motivoDetalle}` : ""}
                </span>
                <span className="text-amber-600">Queda en el backlog del activo.</span>
                {editable ? (
                  <button
                    type="button"
                    onClick={() => deshacerLiberar(task)}
                    className="inline-flex items-center gap-1 rounded border border-amber-300 px-1.5 py-0.5 font-medium text-amber-800 hover:bg-amber-100"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Deshacer
                  </button>
                ) : null}
              </div>
            ) : null}

            {task.taskType === "MEASURE" ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  disabled={!editable}
                  className="field max-w-32"
                  placeholder="Valor"
                  value={values[task.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [task.id]: e.target.value }))}
                  onBlur={(e) =>
                    e.target.value !== "" &&
                    update(task, { resultNumber: Number(e.target.value), done: true })
                  }
                />
                <span className="text-xs text-slate-500">
                  {task.unit}
                  {task.minValue !== null || task.maxValue !== null
                    ? ` · rango ${task.minValue ?? "-∞"} a ${task.maxValue ?? "∞"}`
                    : ""}
                </span>
              </div>
            ) : null}

            {editable && !task.done && !task.liberadaAt ? (
              <button
                type="button"
                onClick={() => abrirLiberar(task)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-amber-700"
              >
                <PackageX className="h-3.5 w-3.5" />
                No se pudo hacer
              </button>
            ) : null}

            {task.taskType === "TEXT" ? (
              <input
                disabled={!editable}
                className="field mt-2"
                placeholder="Observaciones"
                value={values[task.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [task.id]: e.target.value }))}
                onBlur={(e) => e.target.value && update(task, { resultText: e.target.value, done: true })}
              />
            ) : null}
          </div>
        </li>
          ))}
          </ul>
          ) : null}
        </div>
        );
      })}

      {/* Al portal: la barra superior usa backdrop-blur y eso la vuelve bloque
          contenedor de cualquier `fixed` que viva dentro del shell. */}
      {liberando && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.target === e.currentTarget && setLiberando(null)}
            >
              <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
                <h3 className="text-sm font-semibold text-slate-800">No se pudo hacer</h3>
                <p className="mt-1 text-xs text-slate-500">{liberando.title}</p>
                <p className="mt-2 text-xs text-slate-500">
                  La actividad sale de esta orden y queda en el backlog del activo, con el motivo,
                  para que otra orden la retome. Nada se pierde.
                </p>

                <label className="label mt-4 block">Por que no se pudo</label>
                <select className="field" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                  {Object.entries(MOTIVOS_LIBERACION).map(([clave, texto]) => (
                    <option key={clave} value={clave}>{texto}</option>
                  ))}
                </select>

                {motivo === "SIN_REFACCION" && refacciones.length ? (
                  <>
                    <label className="label mt-3 block">Cual refacción falto</label>
                    <SelectorBuscable
                      valor={partId}
                      onCambio={setPartId}
                      vacio="Sin especificar"
                      marcador="Busque por clave o descripción"
                      opciones={refacciones.map((r) => ({ id: r.id, etiqueta: `${r.code} — ${r.name}` }))}
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      Si la indica, el backlog le avisara cuando ya haya existencia.
                    </p>
                  </>
                ) : null}

                <label className="label mt-3 block">Detalle (opcional)</label>
                <textarea
                  className="field min-h-16"
                  maxLength={400}
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  placeholder="Lo que ayude a quien lo retome"
                />

                {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}

                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setLiberando(null)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={guardando}
                    onClick={confirmarLiberar}
                  >
                    {guardando ? "Liberando…" : "Liberar al backlog"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
