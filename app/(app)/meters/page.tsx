import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatDia, formatNumber } from "@/lib/utils";
import { MeterReadingForm } from "./reading-form";
import { Lecturas } from "./lecturas";
import { ConfigMedidor } from "./config-medidor";

export const metadata = { title: "Medidores" };
export const dynamic = "force-dynamic";

export default async function MetersPage() {
  const user = await requireUser();
  const puedeCorregir = can(user.role, "asset:write");

  const meters = await prisma.meter.findMany({
    where: { organizationId: user.organizationId },
    include: {
      asset: { select: { id: true, code: true, name: true } },
      readings: {
        orderBy: [{ readingAt: "desc" }, { id: "desc" }],
        take: 6,
        include: { user: { select: { name: true } } },
      },
      // Los planes por uso viven en la ASIGNACION de cada equipo, no en el
      // encabezado del plan: un plan de diez compresores tiene diez metas.
      asignaciones: {
        where: { active: true, nextDueMeter: { not: null }, plan: { active: true } },
        select: { id: true, nextDueMeter: true, nextDueDate: true, plan: { select: { name: true } } },
      },
    },
    orderBy: { lastReadingAt: "desc" },
  });

  const idsCorrectores = [...new Set(meters.flatMap((m) => m.readings.map((r) => r.correccionPorId).filter(Boolean)))] as string[];
  const correctores = idsCorrectores.length
    ? await prisma.user.findMany({ where: { id: { in: idsCorrectores }, organizationId: user.organizationId }, select: { id: true, name: true } })
    : [];

  const stale = meters.filter(
    (m) => !m.lastReadingAt || Date.now() - m.lastReadingAt.getTime() > 7 * 86_400_000,
  ).length;

  return (
    <>
      <PageHeader
        title="Lecturas de medidores"
        description="Horómetros, odómetros y contadores de ciclos. Cada lectura se valida contra la anterior y recalcula el uso diario y la fecha estimada de los planes por uso."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Medidores" value={meters.length} />
        <Stat label="Sin lectura reciente" value={stale} tone={stale ? "warn" : "good"} hint="Más de 7 días" />
        <Stat label="Planes por uso" value={meters.reduce((s, m) => s + m.asignaciones.length, 0)} />
      </div>

      {meters.length === 0 ? (
        <EmptyState
          title="Sin medidores"
          description="Registre medidores desde la ficha del activo para habilitar planes basados en uso real."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {meters.map((meter) => {
            const pending = meter.asignaciones.map((a) => ({
              id: a.id,
              name: a.plan.name,
              remaining: (a.nextDueMeter as number) - meter.currentValue,
              fecha: a.nextDueDate,
            }));

            return (
              <Card key={meter.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900">{meter.name}</h3>
                    <Link href={`/assets/${meter.asset.id}`} className="text-xs text-slate-500 hover:text-brand-600">
                      {meter.asset.code} · {meter.asset.name}
                    </Link>
                    <div className="mt-0.5">
                      {puedeCorregir ? (
                        <ConfigMedidor meterId={meter.id} unit={meter.unit} tipo={meter.tipo} maxIncrementoDiario={meter.maxIncrementoDiario} />
                      ) : null}
                    </div>
                  </div>
                  {meter.lecturaVigente ? (
                    <div className="text-right">
                      <p className="text-xl font-semibold tabular-nums text-slate-900">
                        {formatNumber(meter.currentValue, 0)}
                        <span className="ml-1 text-xs text-slate-400">{meter.unit}</span>
                      </p>
                      <p className="text-[0.625rem] text-slate-400" title="Uso de los últimos 90 días entre los días que abarcan las lecturas">
                        {meter.dailyAverage > 0 ? `${formatNumber(meter.dailyAverage, 1)} ${meter.unit}/día` : "Promedio sin datos suficientes"}
                      </p>
                    </div>
                  ) : (
                    <div className="text-right">
                      <p className="text-sm font-semibold text-amber-700">Sin lectura vigente</p>
                      <p className="text-[0.625rem] text-slate-500">Requiere una lectura nueva</p>
                    </div>
                  )}
                </div>

                {pending.length && meter.lecturaVigente ? (
                  <ul className="mt-3 grid gap-1.5 rounded-lg bg-slate-50 p-2.5">
                    {pending.map((plan) => (
                      <li key={plan.id} className="flex items-center justify-between gap-2 text-[0.6875rem]">
                        <span className="truncate text-slate-600">{plan.name}</span>
                        <span
                          className={
                            plan.remaining <= 0
                              ? "shrink-0 font-semibold text-red-600"
                              : plan.remaining < (meter.dailyAverage || 1) * 7
                                ? "shrink-0 font-medium text-amber-600"
                                : "shrink-0 text-slate-500"
                          }
                        >
                          {plan.remaining <= 0
                            ? "Vencido"
                            : `Faltan ${formatNumber(plan.remaining, 0)} ${meter.unit}${plan.fecha ? ` · aprox. ${formatDia(plan.fecha)}` : ""}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-3">
                  <MeterReadingForm meterId={meter.id} unit={meter.unit} current={meter.lecturaVigente ? meter.currentValue : null} />
                </div>

                <Lecturas
                  unit={meter.unit}
                  puedeCorregir={puedeCorregir}
                  lecturas={meter.readings.map((r) => ({
                    id: r.id,
                    value: r.value,
                    delta: r.delta,
                    readingAt: r.readingAt.toISOString(),
                    usuario: r.user?.name ?? null,
                    tipo: r.tipo,
                    estado: r.estado,
                    atipica: r.atipica,
                    justificacion: r.justificacion,
                    valorOriginal: r.valorOriginal,
                    tipoOriginal: r.tipoOriginal,
                    valorAnterior: r.valorAnterior,
                    correccionMotivo: r.correccionMotivo,
                    correccionPor: correctores.find((c) => c.id === r.correccionPorId)?.name ?? null,
                    correccionEl: r.correccionEl?.toISOString() ?? null,
                  }))}
                />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
