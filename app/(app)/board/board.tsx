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
import { cn, dueLabel, formatNumber } from "@/lib/utils";

type Item = {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  maintenanceType: string;
  dueDate: string | null;
  asset: string | null;
  assignee: string | null;
  assigneeColor: string | null;
  estimatedHours: number;
};

export function KanbanBoard({ workOrders }: { workOrders: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(workOrders);
  const [dragging, setDragging] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(item: Item, status: string) {
    if (item.status === status) return;
    if (!STATUS_TRANSITIONS[item.status]?.includes(status)) {
      setError(`No se permite mover de ${WO_STATUS_LABELS[item.status]} a ${WO_STATUS_LABELS[status]}`);
      return;
    }
    setError(null);
    const previous = items;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));

    const res = await fetch(`/api/work-orders/${item.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "No fue posible mover la orden");
      setItems(previous);
      return;
    }
    router.refresh();
  }

  return (
    <>
      {error ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>
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
                  const due = dueLabel(item.dueDate);
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
                      <p className={cn("mt-1.5 text-[0.625rem]", due.tone === "danger" ? "text-red-600" : "text-slate-400")}>
                        {due.text}
                      </p>
                    </div>
                  );
                })}
                {column.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-[0.6875rem] text-slate-400">
                    Vacio
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
