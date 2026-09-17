import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { forecastSchedule } from "@/lib/scheduler";
import { cargaPorDia, jornada, propuestasDeCarga } from "@/lib/agenda";
import { PageHeader } from "@/components/ui";
import { OPEN_STATUSES } from "@/lib/constants";
import { RunSchedulerButton } from "./run-scheduler";
import { RevisarSemana } from "./revisar-semana";
import { Calendario } from "./calendario";
import { zonaDeLaEmpresa } from "@/lib/indicadores";
import { estadoDeVencimiento } from "@/lib/vencimiento";
import { semanaARevisar } from "@/lib/semana";
import { claveDiaEnZona } from "@/lib/periodos";

export const metadata = { title: "Calendario" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; vista?: string; semana?: string; dia?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const vista =
    params.vista === "semana" ? "semana" : params.vista === "dia" ? "dia" : "mes";

  // El rango depende de la vista, pero de ahi en adelante todo es igual: los
  // mismos datos, la misma carga calculada. La vista solo cambia como se pinta.
  let first: Date;
  let last: Date;
  if (vista === "dia") {
    const d = params.dia ? new Date(`${params.dia}T00:00:00`) : new Date();
    d.setHours(0, 0, 0, 0);
    first = d;
    last = new Date(d);
    last.setHours(23, 59, 59);
  } else if (vista === "semana") {
    const refe = params.semana ? new Date(`${params.semana}T00:00:00`) : new Date();
    const lunes = new Date(refe);
    lunes.setDate(refe.getDate() - ((refe.getDay() + 6) % 7));
    lunes.setHours(0, 0, 0, 0);
    first = lunes;
    last = new Date(lunes);
    last.setDate(lunes.getDate() + 6);
    last.setHours(23, 59, 59);
  } else {
    const base = params.month ? new Date(`${params.month}-01T00:00:00`) : new Date();
    first = new Date(base.getFullYear(), base.getMonth(), 1);
    last = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59);
  }
  const year = first.getFullYear();
  const month = first.getMonth();

  const incluir = {
    asset: { select: { id: true, code: true, name: true, categoryId: true } },
    assignedTo: { select: { id: true, name: true, color: true, horasDisponibles: true } },
  };

  // «Vencida» con la regla de todas las pantallas: abierta y con el dia
  // compromiso ya pasado EN LA ZONA DE LA EMPRESA. Se acota en la base con un
  // dia de holgura y se decide con `estadoDeVencimiento`.
  const zona = await zonaDeLaEmpresa(user.organizationId);
  const manana = new Date(Date.now() + 86_400_000);

  const [ordenes, vencidas, proyectado, j, tecnicos, activos, familias] = await Promise.all([
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
        dueDate: { lt: manana },
      },
      include: incluir,
      orderBy: { dueDate: "asc" },
      take: 80,
    }).then((xs) => xs.filter((o) => estadoDeVencimiento(o, { zona }).clave === "VENCIDA").slice(0, 50)),
    forecastSchedule(user.organizationId, 120),
    jornada(user.organizationId, first, last),
    prisma.user.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
    // Solo los equipos que aparecen en el calendario: filtrar por uno que no
    // tiene nada programado no le sirve a nadie y alarga la lista.
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, categoryId: true },
    }),
    prisma.assetCategory.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const generados = new Set(ordenes.map((o) => o.planId).filter(Boolean));
  const proyecciones = proyectado.filter((e) => {
    const d = new Date(e.date);
    return d >= first && d <= last && !generados.has(e.planId);
  });

  const cuantos =
    Math.round((new Date(last).setHours(0, 0, 0, 0) - first.getTime()) / 86_400_000) + 1;
  const dias = Array.from({ length: cuantos }, (_, i) => {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    return d;
  });
  const carga = cargaPorDia(dias, ordenes, j);
  const plantilla = await prisma.user.findMany({
    where: { organizationId: user.organizationId, active: true, role: { in: ["TECHNICIAN", "SUPERVISOR"] } },
    select: { id: true, name: true, horasDisponibles: true },
  });

  return (
    <>
      {/* Encabezado compacto: el calendario tiene que entrar en la pantalla sin
          desplazarse. Titulo, descripcion y los dos botones en una sola franja;
          el resultado de la IA aparece debajo solo cuando hay algo que mostrar. */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Calendario de mantenimiento</h1>
          <p className="text-xs text-slate-500">
            Lo programado, lo proyectado y si de verdad cabe en los días que quedan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RevisarSemana
            semana={semanaARevisar({
              vista,
              desde: first.toISOString().slice(0, 10),
              hasta: last.toISOString().slice(0, 10),
              hoy: claveDiaEnZona(new Date(), zona),
            })}
          />
          <RunSchedulerButton />
        </div>
      </div>
      <Calendario
        vista={vista}
        mes={`${year}-${String(month + 1).padStart(2, "0")}`}
        semana={first.toISOString().slice(0, 10)}
        dia={first.toISOString().slice(0, 10)}
        dias={dias.map((d) => d.toISOString())}
        carga={carga.map((c, i) => ({
          ...c,
          fecha: c.fecha.toISOString(),
          propuestas: propuestasDeCarga(i, carga, plantilla, j).map((p) => ({
            ...p,
            dias: p.dias.map((d) => ({ fecha: d.fecha.toISOString(), libres: d.libres })),
          })),
        }))}
        ordenes={ordenes.map((o) => ({
          id: o.id, number: o.number, title: o.title,
          maintenanceType: o.maintenanceType, status: o.status,
          estimatedHours: o.estimatedHours,
          dueDate: o.dueDate?.toISOString() ?? null,
          vencimiento: estadoDeVencimiento(o, { zona }).texto,
          asset: o.asset, assignedTo: o.assignedTo,
        }))}
        vencidas={vencidas.map((o) => ({
          id: o.id, number: o.number, title: o.title,
          maintenanceType: o.maintenanceType, status: o.status,
          estimatedHours: o.estimatedHours,
          dueDate: o.dueDate?.toISOString() ?? null,
          vencimiento: estadoDeVencimiento(o, { zona }).texto,
          asset: o.asset, assignedTo: o.assignedTo,
        }))}
        proyecciones={proyecciones.map((p) => ({
          id: p.id, title: p.title, asset: p.asset, date: new Date(p.date).toISOString(),
          assetId: p.assetId, categoryId: p.categoryId, titulos: p.titulos,
        }))}
        tecnicos={tecnicos}
        activos={activos}
        familias={familias}
        horasJornada={j.horasJornada}
      />
    </>
  );
}
