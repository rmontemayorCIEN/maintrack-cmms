import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { calcularIndicadores, periodoDeLaEmpresa, type ClaveIndicador } from "@/lib/indicadores";
import { PERIODOS_INDICADORES, describirPeriodo, diasDeParametro, fechaHoraEnZona } from "@/lib/periodos";
import { valorDeIndicador } from "@/components/tarjeta-indicador";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const metadata = { title: "Detalle de indicador" };
export const dynamic = "force-dynamic";

export default async function IndicadorPage({
  params,
  searchParams,
}: {
  params: Promise<{ clave: string }>;
  searchParams: Promise<{ dias?: string }>;
}) {
  const user = await requireUser();
  const { clave } = await params;
  const dias = diasDeParametro((await searchParams).dias);
  const periodo = await periodoDeLaEmpresa(user.organizationId, dias);
  const todos = await calcularIndicadores(user.organizationId, periodo);
  const ind = todos.indicadores[clave as ClaveIndicador];
  if (!ind) notFound();

  const moneda = user.organization.currency;
  const zona = periodo.zonaHoraria;
  // Disponibilidad es un porcentaje, pero su detalle son horas de paro; MTBF
  // son horas, pero su detalle son fallas contadas.
  const esProporcion = ind.unidad === "%" && ind.clave !== "disponibilidad";
  const esConteo = ind.clave === "mtbf" || ind.clave === "backlog";
  const esPromedio = ind.clave === "mttr" || ind.clave === "tiempoRespuesta";
  const aporte = (n: number) =>
    ind.unidad === "MXN" ? formatCurrency(n, moneda) : esConteo ? formatNumber(n, 0) : `${formatNumber(n, 1)} h`;
  const suma = ind.detalle.reduce((s, r) => s + r.aporte, 0);
  const aFavor = ind.detalle.filter((r) => r.aFavor).length;
  const conRazon = ind.detalle.some((r) => r.razon);

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/reports" className="hover:underline">Reportes e indicadores</Link>}
        title={ind.nombre}
        description={`${describirPeriodo(periodo)} · zona ${zona}`}
        actions={
          <div className="flex flex-wrap gap-1">
            {Object.entries(PERIODOS_INDICADORES).map(([d, etiqueta]) => (
              <Link
                key={d}
                href={`/indicadores/${ind.clave}?dias=${d}`}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                  Number(d) === dias
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {etiqueta}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <Card>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">Valor</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{valorDeIndicador(ind, moneda, 2)}</p>
          {ind.sinValor ? <p className="mt-1 text-xs text-slate-500">{ind.sinValor}</p> : null}
          <p className="mt-3 text-xs text-slate-500">Actualizado el {fechaHoraEnZona(todos.actualizadoEl, zona)}</p>
        </Card>

        <Card className="lg:col-span-2">
          <p className="text-sm text-slate-700">{ind.definicion}</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="font-semibold text-slate-500">Fórmula</dt>
            <dd className="text-slate-800">{ind.formula}</dd>
            <dt className="font-semibold text-slate-500">Con los datos de hoy</dt>
            <dd className="tabular-nums text-slate-800">{ind.calculo}</dd>
            <dt className="font-semibold text-slate-500">Estados de OT</dt>
            <dd className="text-slate-800">{ind.alcance.estadosOT}</dd>
            <dt className="font-semibold text-slate-500">Tipos de trabajo</dt>
            <dd className="text-slate-800">{ind.alcance.tiposTrabajo}</dd>
            <dt className="font-semibold text-slate-500">Tipos de paro</dt>
            <dd className="text-slate-800">{ind.alcance.tiposParo}</dd>
            <dt className="font-semibold text-slate-500">Fecha que cuenta</dt>
            <dd className="text-slate-800">{ind.alcance.fechaQueCuenta}</dd>
            <dt className="font-semibold text-slate-500">Periodo</dt>
            <dd className="text-slate-800">
              {periodo.etiqueta}: {describirPeriodo(periodo)}, días completos en {zona}
            </dd>
          </dl>
          {ind.notas.length ? (
            <ul className="mt-3 grid gap-1 text-xs text-amber-700">
              {ind.notas.map((n) => <li key={n}>{n}</li>)}
            </ul>
          ) : null}
        </Card>
      </div>

      <Card className="mt-4" padded={false}>
        <div className="px-5 py-4">
          <CardHeader
            title={`Registros que forman la cifra (${ind.detalle.length})`}
            subtitle={
              esProporcion
                ? `${aFavor} a favor de ${ind.detalle.length}`
                : esPromedio
                  ? `Suma ${aporte(suma)} ÷ ${ind.detalle.length}`
                  : esConteo
                    ? `${ind.detalle.length} registro(s)`
                    : `Suma ${aporte(suma)}`
            }
          />
        </div>
        {ind.detalle.length === 0 ? (
          <p className="px-5 pb-6 text-center text-xs text-slate-400">Sin registros en el periodo</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Descripción</th>
                  <th>Activo</th>
                  <th>Fecha</th>
                  {conRazon ? <th>Por qué cuenta como falla</th> : null}
                  <th className="text-right">{esProporcion ? "Cuenta" : "Aporte"}</th>
                </tr>
              </thead>
              <tbody>
                {ind.detalle.map((r) => (
                  <tr key={`${r.tipo}-${r.id}`}>
                    <td className="text-xs">
                      {r.workOrderId ? (
                        <Link href={`/work-orders/${r.workOrderId}`} className="font-medium text-brand-600 hover:underline">
                          {r.folio ?? "OT"}
                        </Link>
                      ) : (
                        <span className="text-slate-400">{r.tipo === "PARO" ? "Paro sin OT" : "—"}</span>
                      )}
                    </td>
                    <td className="max-w-72 truncate text-xs text-slate-700">{r.titulo}</td>
                    <td className="text-xs text-slate-600">{r.activo ?? "—"}</td>
                    <td className="whitespace-nowrap text-xs text-slate-600">
                      {r.fecha ? fechaHoraEnZona(r.fecha, zona) : "—"}
                    </td>
                    {conRazon ? <td className="text-xs text-slate-600">{r.razon ?? "—"}</td> : null}
                    <td className="text-right text-xs tabular-nums">
                      {esProporcion ? (
                        <Badge tone={r.aFavor ? "success" : "danger"}>{r.aFavor ? "A favor" : "En contra"}</Badge>
                      ) : (
                        aporte(r.aporte)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
