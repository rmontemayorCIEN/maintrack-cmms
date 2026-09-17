"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Badge } from "@/components/ui";
import {
  BOARD_STATUSES,
  MAINTENANCE_TYPE_COLORS,
  MAINTENANCE_TYPE_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_TRANSITIONS,
  WO_STATUS_LABELS,
} from "@/lib/constants";
import { pideMotivo } from "@/lib/reglas-ot";
import { cn, formatNumber } from "@/lib/utils";
import { estadoDeVencimiento } from "@/lib/vencimiento";

type Item = {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  maintenanceType: string;
  dueDate: string | null;
  completedAt: string | null;
  asset: string | null;
  assignee: string | null;
  assigneeColor: string | null;
  estimatedHours: number;
};

export function KanbanBoard({ workOrders, zona }: { workOrders: Item[]; zona: string }) {
  const router = useRouter();
  const [items, setItems] = useState(workOrders);
  const [dragging, setDragging] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorOrden, setErrorOrden] = useState<string | null>(null);

  async function move(item: Item, status: string) {
    if (item.status === status) return;
    if (!STATUS_TRANSITIONS[item.status]?.includes(status)) {
      setError(`No se permite mover de ${WO_STATUS_LABELS[item.status]} a ${WO_STATUS_LABELS[status]}`);
      return;
    }
    /**
     * Arrastrar no alcanza para los pasos que piden datos: completar pide la
     * solucion y las horas, pausar y cancelar piden motivo, e iniciar una orden
     * sin responsable pide quien la toma. Esos se hacen desde la orden, donde
     * estan los campos; mandarlos vacios solo produciria un rechazo.
     */
    const necesita =
      status === "COMPLETED" ? "completarla (solución, horas y diagnóstico)"
        : pideMotivo(item.status, status) ? "indicar el motivo"
        : status === "IN_PROGRESS" && !item.assignee ? "elegir quién la toma"
        : null;
    if (necesita) {
      setError(`Abra ${item.number} para ${necesita}.`);
      setErrorOrden(item.id);
      return;
    }
    setError(null);
    setErrorOrden(null);
    const previous = items;
    // Al completar, la fecha de finalizacion es ahora; al reabrir se borra,
    // igual que en el servidor. Asi la etiqueta no dice «Vencida» de algo hecho.
    const completedAt = status === "COMPLETED" ? new Date().toISOString() : status === "CLOSED" ? item.completedAt : null;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status, completedAt } : i)));

    const res = await fetch(`/api/work-orders/${item.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "No fue posible mover la orden");
      setErrorOrden(item.id);
      setItems(previous);
      return;
    }
    router.refresh();
  }

  return (
    <>
      {error ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error}
          {errorOrden ? (
            <Link href={`/work-orders/${errorOrden}`} className="ml-2 font-medium underline">Abrir la orden</Link>
          ) : null}
        </p>
      ) : null}

      <div className="grid gap-3 overflow-x-auto lg:grid-cols-5">
        {BOARD_STATUSES.map((status) => {
          const column = items.filter((i) => i.status === status);
          const hours = column.reduce((sum, i) => sum + i.estimatedHours, 0);
          return (
            <div
              key={status}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragging && move(dragging, status)}
              className="min-w-64 rounded-xl border border-slate-200 bg-slate-50/70 p-2 lg:min-w-0"
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs font-semibold text-slate-700">{WO_STATUS_LABELS[status]}</p>
                <span className="rounded-full bg-white px-2 py-0.5 text-[0.625rem] font-medium text-slate-500">
                  {column.length} · {formatNumber(hours, 0)} h
                </span>
              </div>
              <div className="grid gap-2">
                {column.map((item) => {
                  const due = estadoDeVencimiento(item, { zona });
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => setDragging(item)}
                      onDragEnd={() => setDragging(null)}
                      className={cn(
                        "cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition-shadow hover:shadow",
                        dragging?.id === item.id && "opacity-50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/work-orders/${item.id}`} className="text-[0.6875rem] font-semibold text-brand-600 hover:underline">
                          {item.number}
                        </Link>
                        <Badge className={PRIORITY_COLORS[item.priority]}>{PRIORITY_LABELS[item.priority]}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-800">{item.title}</p>
                      {item.asset ? <p className="mt-0.5 truncate text-[0.6875rem] text-slate-500">{item.asset}</p> : null}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Badge className={MAINTENANCE_TYPE_COLORS[item.maintenanceType]}>
                          {MAINTENANCE_TYPE_LABELS[item.maintenanceType]}
                        </Badge>
                        {item.assignee ? <Avatar name={item.assignee} color={item.assigneeColor ?? undefined} /> : null}
                      </div>
                      <p className={cn("mt-1.5 text-[0.625rem]", due.tono === "danger" ? "text-red-600" : due.tono === "warning" ? "text-amber-600" : due.tono === "success" ? "text-emerald-600" : "text-slate-400")}>
                        {due.texto}
                      </p>
                    </div>
                  );
                })}
                {column.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-[0.6875rem] text-slate-400">
                    Vacío
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
