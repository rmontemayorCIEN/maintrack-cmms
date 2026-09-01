import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { forecastSchedule } from "@/lib/scheduler";
import { Badge, Card, PageHeader } from "@/components/ui";
import { MAINTENANCE_TYPE_COLORS, MAINTENANCE_TYPE_LABELS, OPEN_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { RunSchedulerButton } from "./run-scheduler";

export const metadata = { title: "Calendario" };
export const dynamic = "force-dynamic";

const WEEKDAYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const base = params.month ? new Date(`${params.month}-01T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);

  const [workOrders, projected] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        organizationId: user.organizationId,
        dueDate: { gte: first, lte: new Date(year, month + 1, 0, 23, 59, 59) },
      },
      include: { asset: { select: { code: true } } },
      orderBy: { dueDate: "asc" },
    }),
    forecastSchedule(user.organizationId, 120),
  ]);

  // Se muestran solo las proyecciones que aun no tienen OT generada este mes.
  const generatedPlanIds = new Set(workOrders.map((wo) => wo.planId).filter(Boolean));
  const projections = projected.filter((event) => {
    const date = new Date(event.date);
    return date >= first && date <= last && !generatedPlanIds.has(event.planId);
  });

  const offset = (first.getDay() + 6) % 7; // Semana inicia en lunes
  const cells: Array<Date | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: last.getDate() }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(first);
  const prev = new Date(year, month - 1, 1).toISOString().slice(0, 7);
  const next = new Date(year, month + 1, 1).toISOString().slice(0, 7);
  const today = new Date().toDateString();

  return (
    <>
      <PageHeader
        title="Calendario de mantenimiento"
        description="Ordenes programadas y proyeccion de los planes preventivos que aun no se han generado."
        actions={<RunSchedulerButton />}
      />

      <Card padded={false}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold capitalize text-slate-900">{monthLabel}</h2>
          <div className="flex items-center gap-1.5">
            <Link href={`/calendar?month=${prev}`} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Anterior
            </Link>
            <Link href="/calendar" className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Hoy
            </Link>
            <Link href={`/calendar?month=${next}`} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Siguiente
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/60">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-2 text-center text-[0.625rem] font-semibold uppercase tracking-wide text-slate-500">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((date, index) => {
            if (!date) return <div key={index} className="min-h-28 border-b border-r border-slate-100 bg-slate-50/40" />;
            const dayWorkOrders = workOrders.filter((wo) => wo.dueDate?.toDateString() === date.toDateString());
            const dayProjections = projections.filter((p) => new Date(p.date).toDateString() === date.toDateString());
            const isToday = date.toDateString() === today;
            const isWeekend = [0, 6].includes(date.getDay());

            return (
              <div
                key={index}
                className={cn(
                  "min-h-28 border-b border-r border-slate-100 p-1.5",
                  isWeekend && "bg-slate-50/40",
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full text-[0.6875rem] font-medium",
                      isToday ? "bg-brand-600 text-white" : "text-slate-500",
                    )}
                  >
                    {date.getDate()}
                  </span>
                  {dayWorkOrders.length + dayProjections.length > 3 ? (
                    <span className="text-[9px] text-slate-400">
                      {dayWorkOrders.length + dayProjections.length}
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-1">
                  {dayWorkOrders.slice(0, 3).map((wo) => (
                    <Link
                      key={wo.id}
                      href={`/work-orders/${wo.id}`}
                      className={cn(
                        "block truncate rounded border px-1.5 py-0.5 text-[0.625rem] font-medium",
                        MAINTENANCE_TYPE_COLORS[wo.maintenanceType],
                        !OPEN_STATUSES.includes(wo.status) && "opacity-50 line-through",
                      )}
                      title={`${wo.number} — ${wo.title}`}
                    >
                      {wo.number} {wo.title}
                    </Link>
                  ))}
                  {dayProjections.slice(0, 2).map((event) => (
                    <span
                      key={event.id}
                      className="block truncate rounded border border-dashed border-slate-300 bg-white px-1.5 py-0.5 text-[0.625rem] text-slate-500"
                      title={`Proyectado: ${event.title} — ${event.asset}`}
                    >
                      ◇ {event.title}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Leyenda:</span>
        {Object.entries(MAINTENANCE_TYPE_LABELS).map(([key, label]) => (
          <Badge key={key} className={MAINTENANCE_TYPE_COLORS[key]}>{label}</Badge>
        ))}
        <span className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[0.6875rem]">
          ◇ Proyeccion del plan (aun no generada)
        </span>
      </div>
    </>
  );
}
