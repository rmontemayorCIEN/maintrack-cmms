import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { MeterReadingForm } from "./reading-form";

export const metadata = { title: "Medidores" };
export const dynamic = "force-dynamic";

export default async function MetersPage() {
  const user = await requireUser();

  const meters = await prisma.meter.findMany({
    where: { organizationId: user.organizationId },
    include: {
      asset: { select: { id: true, code: true, name: true } },
      readings: { orderBy: { readingAt: "desc" }, take: 5, include: { user: { select: { name: true } } } },
      plans: { where: { active: true }, select: { id: true, name: true, intervalMeter: true, nextDueMeter: true } },
    },
    orderBy: { lastReadingAt: "desc" },
  });

  const stale = meters.filter(
    (m) => !m.lastReadingAt || Date.now() - m.lastReadingAt.getTime() > 7 * 86_400_000,
  ).length;

  return (
    <>
      <PageHeader
        title="Lecturas de medidores"
        description="Horometros, odometros y contadores de ciclos. Cada lectura recalcula el uso promedio diario y adelanta o retrasa los planes por medidor."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Stat label="Medidores" value={meters.length} />
        <Stat label="Sin lectura reciente" value={stale} tone={stale ? "warn" : "good"} hint="Mas de 7 dias" />
        <Stat label="Planes por uso" value={meters.reduce((s, m) => s + m.plans.length, 0)} />
      </div>

      {meters.length === 0 ? (
        <EmptyState
          title="Sin medidores"
          description="Registre medidores desde la ficha del activo para habilitar planes basados en uso real."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {meters.map((meter) => {
            const pending = meter.plans
              .map((plan) =>
                plan.nextDueMeter != null
                  ? { name: plan.name, remaining: plan.nextDueMeter - meter.currentValue }
                  : null,
              )
              .filter(Boolean) as Array<{ name: string; remaining: number }>;

            return (
              <Card key={meter.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">{meter.name}</h3>
                    <Link href={`/assets/${meter.asset.id}`} className="text-xs text-slate-500 hover:text-brand-600">
                      {meter.asset.code} · {meter.asset.name}
                    </Link>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold tabular-nums text-slate-900">
                      {formatNumber(meter.currentValue, 0)}
                      <span className="ml-1 text-xs text-slate-400">{meter.unit}</span>
                    </p>
                    <p className="text-[0.625rem] text-slate-400">
                      {formatNumber(meter.dailyAverage, 1)} {meter.unit}/dia
                    </p>
                  </div>
                </div>

                {pending.length ? (
                  <ul className="mt-3 grid gap-1.5 rounded-lg bg-slate-50 p-2.5">
                    {pending.map((plan) => (
                      <li key={plan.name} className="flex items-center justify-between text-[0.6875rem]">
                        <span className="truncate text-slate-600">{plan.name}</span>
                        <span
                          className={
                            plan.remaining <= 0
                              ? "font-semibold text-red-600"
                              : plan.remaining < (meter.dailyAverage || 1) * 7
                                ? "font-medium text-amber-600"
                                : "text-slate-500"
                          }
                        >
                          {plan.remaining <= 0
                            ? "Vencido"
                            : `Faltan ${formatNumber(plan.remaining, 0)} ${meter.unit}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-3">
                  <MeterReadingForm meterId={meter.id} unit={meter.unit} current={meter.currentValue} />
                </div>

                {meter.readings.length ? (
                  <ul className="mt-3 grid gap-1 border-t border-slate-100 pt-3">
                    {meter.readings.map((reading) => (
                      <li key={reading.id} className="flex items-center justify-between text-[0.6875rem] text-slate-500">
                        <span>{formatDateTime(reading.readingAt)} · {reading.user?.name ?? "Sistema"}</span>
                        <span className="tabular-nums">
                          {formatNumber(reading.value, 0)} {meter.unit}
                          {reading.delta ? ` (+${formatNumber(reading.delta, 0)})` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
