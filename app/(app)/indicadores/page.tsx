import Link from "next/link";
import { Suspense } from "react";
import { verCostos } from "@/lib/pantallas";
import { PanelTendencias } from "./panel-tendencias";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { calcularIndicadores, periodoDeLaEmpresa } from "@/lib/indicadores";
import { PERIODOS_INDICADORES, describirPeriodo, diasDeParametro, fechaHoraEnZona } from "@/lib/periodos";
import { enlaceDeIndicador, valorDeIndicador } from "@/components/tarjeta-indicador";

export const metadata = { title: "Indicadores" };
export const dynamic = "force-dynamic";

/** El glosario vivo de los indicadores: definicion, formula y valor del periodo. */
export default async function IndicadoresPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const user = await requireUser();
  const dias = diasDeParametro((await searchParams).dias);
  const periodo = await periodoDeLaEmpresa(user.organizationId, dias);
  const k = await calcularIndicadores(user.organizationId, periodo);

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/reports" className="hover:underline">Reportes e indicadores</Link>}
        title="Cómo se calculan los indicadores"
        description={`${describirPeriodo(periodo)} · zona ${periodo.zonaHoraria} · actualizado ${fechaHoraEnZona(k.actualizadoEl, periodo.zonaHoraria)}`}
        actions={
          <div className="flex flex-wrap gap-1">
            {Object.entries(PERIODOS_INDICADORES).map(([d, etiqueta]) => (
              <Link
                key={d}
                href={`/indicadores?dias=${d}`}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                  Number(d) === dias ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {etiqueta}
              </Link>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {Object.values(k.indicadores).map((ind) => (
          <Link key={ind.clave} href={enlaceDeIndicador(ind, dias)} className="block">
            <Card className="h-full transition-colors hover:border-brand-300">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">{ind.nombre}</h3>
                <span className="shrink-0 text-lg font-semibold tabular-nums text-slate-900">{valorDeIndicador(ind, user.organization.currency)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{ind.definicion}</p>
              <p className="mt-2 text-[0.6875rem] text-slate-500"><span className="font-semibold">Fórmula:</span> {ind.formula}</p>
              <p className="mt-0.5 text-[0.6875rem] text-slate-500"><span className="font-semibold">Cuenta:</span> {ind.alcance.estadosOT} · {ind.alcance.fechaQueCuenta}</p>
            </Card>
          </Link>
        ))}
      </div>
      {/* Las gráficas y el desglose que antes estaban en el inicio del dueño. Con costos: solo a quien los ve. */}
      {verCostos(user.role) ? (
        <Suspense fallback={<p className="mt-8 text-sm text-slate-500" role="status">Cargando tendencias…</p>}>
          <PanelTendencias />
        </Suspense>
      ) : null}
    </>
  );
}
