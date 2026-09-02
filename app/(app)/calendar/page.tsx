import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { forecastSchedule } from "@/lib/scheduler";
import { cargaPorDia, jornada } from "@/lib/agenda";
import { PageHeader } from "@/components/ui";
import { OPEN_STATUSES } from "@/lib/constants";
import { RunSchedulerButton } from "./run-scheduler";
import { Calendario } from "./calendario";

export const metadata = { title: "Calendario" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; vista?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const base = params.month ? new Date(`${params.month}-01T00:00:00`) : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0, 23, 59, 59);

  const incluir = {
    asset: { select: { id: true, code: true, name: true } },
    assignedTo: { select: { id: true, name: true, color: true, horasDisponibles: true } },
  };

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const [ordenes, vencidas, proyectado, j, tecnicos] = await Promise.all([
    prisma.workOrder.findMany({
      where: { organizationId: user.organizationId, dueDate: { gte: first, lte: last } },
      include: incluir,
      orderBy: { dueDate: "asc" },
    }),
    // Lo vencido se muestra siempre, sin importar el mes que se este viendo.
    // Antes se quedaba pintado en el mes en que vencio: uno abria el calendario
    // de septiembre y las doce cosas de agosto que seguian abiertas no estaban
    // en ningun lado de la pantalla donde se planea.
    prisma.workOrder.findMany({
      where: {
        organizationId: user.organizationId,
        status: { in: [...OPEN_STATUSES] },
        dueDate: { lt: hoy },
      },
      include: incluir,
      orderBy: { dueDate: "asc" },
      take: 50,
    }),
    forecastSchedule(user.organizationId, 120),
    jornada(user.organizationId, first, last),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
  ]);

  const generados = new Set(ordenes.map((o) => o.planId).filter(Boolean));
  const proyecciones = proyectado.filter((e) => {
    const d = new Date(e.date);
    return d >= first && d <= last && !generados.has(e.planId);
  });

  const dias = Array.from({ length: last.getDate() }, (_, i) => new Date(year, month, i + 1));
  const carga = cargaPorDia(dias, ordenes, j);

  return (
    <>
      <PageHeader
        title="Calendario de mantenimiento"
        description="Lo programado, lo proyectado y si de verdad cabe en los dias que quedan."
        actions={<RunSchedulerButton />}
      />
      <Calendario
        mes={`${year}-${String(month + 1).padStart(2, "0")}`}
        dias={dias.map((d) => d.toISOString())}
        carga={carga.map((c) => ({ ...c, fecha: c.fecha.toISOString() }))}
        ordenes={ordenes.map((o) => ({
          id: o.id, number: o.number, title: o.title,
          maintenanceType: o.maintenanceType, status: o.status,
          estimatedHours: o.estimatedHours,
          dueDate: o.dueDate?.toISOString() ?? null,
          asset: o.asset, assignedTo: o.assignedTo,
        }))}
        vencidas={vencidas.map((o) => ({
          id: o.id, number: o.number, title: o.title,
          maintenanceType: o.maintenanceType, status: o.status,
          estimatedHours: o.estimatedHours,
          dueDate: o.dueDate?.toISOString() ?? null,
          asset: o.asset, assignedTo: o.assignedTo,
        }))}
        proyecciones={proyecciones.map((p) => ({
          id: p.id, title: p.title, asset: p.asset, date: new Date(p.date).toISOString(),
        }))}
        tecnicos={tecnicos}
        horasJornada={j.horasJornada}
      />
    </>
  );
}
