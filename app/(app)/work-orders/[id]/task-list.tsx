"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

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
};

export function TaskList({
  workOrderId,
  tasks,
  editable,
}: {
  workOrderId: string;
  tasks: Task[];
  editable: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
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
        Esta orden no tiene lista de verificacion.
      </p>
    );
  }

  return (
    <ul className="grid gap-2">
      {tasks.map((task, index) => (
        <li
          key={task.id}
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3 transition-colors",
            task.done ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200",
          )}
        >
          <button
            type="button"
            disabled={!editable}
            onClick={() => update(task, { done: !task.done })}
            className={cn(
              "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors",
              task.done
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-slate-300 bg-white hover:border-brand-500",
              !editable && "cursor-not-allowed opacity-60",
            )}
            aria-label={task.done ? "Marcar pendiente" : "Marcar completada"}
          >
            {task.done ? <Check className="h-3.5 w-3.5" /> : null}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">{index + 1}.</span>
              <p className={cn("text-sm font-medium", task.done ? "text-slate-500 line-through" : "text-slate-800")}>
                {task.title}
              </p>
              {task.required ? <Badge tone="muted">Obligatoria</Badge> : null}
              {task.passed === false ? <Badge tone="danger">Fuera de rango</Badge> : null}
              {task.passed === true ? <Badge tone="success">En rango</Badge> : null}
            </div>
            {task.description ? <p className="mt-0.5 text-xs text-slate-500">{task.description}</p> : null}

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
  );
}
