import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatNumber } from "@/lib/utils";
import { formatoUsd } from "@/lib/ia/precios";
import { FUNCIONES_IA, type ClaveFuncionIA } from "@/lib/ia/funciones";
import { periodoActual } from "@/lib/ia/consumo";
import { nombrePeriodo } from "@/lib/cobranza";
import { COMPLEMENTO_IA, iaDeLaOrganizacion, planDe } from "@/lib/planes";
import { iaConfigurada } from "@/lib/ia/cliente";
import { fallasRecientes } from "@/lib/ia/fallas";
import { formatDateTime } from "@/lib/utils";
import { AlertTriangle, Info } from "lucide-react";

export const metadata = { title: "Consumo de IA" };
export const dynamic = "force-dynamic";

/**
 * Consumo de inteligencia artificial por cuenta.
 *
 * Es la vista de operador, no la del cliente: aqui se ven tokens y dolares,
 * que es como factura Anthropic. Al lado va lo que el cliente paga al mes, que
 * es la comparacion que de verdad importa para saber si la funcion se sostiene.
 */
export default async function ConsumoIaPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/dashboard");

  const params = await searchParams;
  const periodo = /^\d{4}-\d{2}$/.test(params.periodo ?? "") ? params.periodo! : periodoActual();

  const [organizaciones, consumos, periodos, historico, fallas] = await Promise.all([
    prisma.organization.findMany({
      select: { id: true, name: true, slug: true, plan: true, status: true, currency: true, iaComplemento: true, iaExtra: true },
      orderBy: { name: "asc" },
    }),
    prisma.aiUsage.groupBy({
      by: ["organizationId", "funcion"],
      where: { periodo },
      _sum: { operaciones: true, costoUsd: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
      _count: { _all: true },
    }),
    prisma.aiUsage.groupBy({ by: ["periodo"], _sum: { costoUsd: true }, orderBy: { periodo: "desc" }, take: 12 }),
    prisma.aiUsage.aggregate({ _sum: { costoUsd: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    fallasRecientes(new Date(Date.now() - 72 * 3_600_000)),
  ]);

  // Un renglon por empresa, con el desglose por funcion adentro.
  const porOrg = new Map<string, {
    operaciones: number; costoUsd: number; tokens: number; llamadas: number;
    funciones: Array<{ funcion: string; operaciones: number; costoUsd: number; llamadas: number }>;
  }>();

  for (const c of consumos) {
    const tokens = (c._sum.inputTokens ?? 0) + (c._sum.outputTokens ?? 0)
      + (c._sum.cacheReadTokens ?? 0) + (c._sum.cacheWriteTokens ?? 0);
    const previo = porOrg.get(c.organizationId) ?? { operaciones: 0, costoUsd: 0, tokens: 0, llamadas: 0, funciones: [] };
    previo.operaciones += c._sum.operaciones ?? 0;
    previo.costoUsd += c._sum.costoUsd ?? 0;
    previo.tokens += tokens;
    previo.llamadas += c._count._all;
    previo.funciones.push({
      funcion: c.funcion,
      operaciones: c._sum.operaciones ?? 0,
      costoUsd: c._sum.costoUsd ?? 0,
      llamadas: c._count._all,
    });
    porOrg.set(c.organizationId, previo);
  }

  const filas = organizaciones
    .map((org) => {
      const consumo = porOrg.get(org.id);
      const entitlement = iaDeLaOrganizacion(org);
      const plan = planDe(org.plan);
      const ingresoMensual = plan.precioMensual + (org.iaComplemento ? COMPLEMENTO_IA.precioMensual : 0);
      return { org, consumo, entitlement, plan, ingresoMensual };
    })
    .sort((a, b) => (b.consumo?.costoUsd ?? 0) - (a.consumo?.costoUsd ?? 0));

  const costoPeriodo = filas.reduce((s, f) => s + (f.consumo?.costoUsd ?? 0), 0);
  const operacionesPeriodo = filas.reduce((s, f) => s + (f.consumo?.operaciones ?? 0), 0);
  const ingresoIa = filas.reduce((s, f) => s + (f.org.iaComplemento ? COMPLEMENTO_IA.precioMensual : 0), 0);

  return (
    <>
      <PageHeader
        title="Consumo de inteligencia artificial"
        description={`Tokens y costo real por cuenta. Los importes son en dolares porque asi factura el proveedor del modelo; lo que cobra usted al cliente esta en ${filas[0]?.org.currency ?? "MXN"}.`}
        breadcrumb={
          <Link href="/clients" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Empresas cliente
          </Link>
        }
      />

      {fallas.length ? (
        <div className="mb-5 grid gap-2">
          {fallas.map((f) => (
            <div
              key={f.clase}
              className={`rounded-lg border px-4 py-3 ${
                f.urgente ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex items-start gap-2">
                {f.urgente
                  ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  : <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${f.urgente ? "text-red-900" : "text-amber-900"}`}>
                    {f.titulo}
                  </p>
                  <p className={`mt-0.5 text-xs ${f.urgente ? "text-red-800" : "text-amber-900"}`}>
                    {f.queHacer}
                  </p>
                  <p className="mt-1 text-[0.6875rem] text-slate-500">
                    {f.ocurrencias} {f.ocurrencias === 1 ? "falla" : "fallas"} en 72 h ·
                    ultima {formatDateTime(f.ultima)} ·
                    {f.empresas.length === 1 ? ` ${f.empresas[0]}` : ` ${f.empresas.length} empresas`}
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[0.6875rem] text-slate-500 hover:text-slate-700">
                      Ver el detalle técnico
                    </summary>
                    <code className="mt-1 block break-all rounded bg-white/60 px-2 py-1 text-[0.625rem] text-slate-600">
                      {f.ejemplo}
                    </code>
                  </details>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!iaConfigurada() ? (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong className="font-semibold">La IA no esta configurada en este servidor.</strong> Falta la variable
          <code className="mx-1 rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code>. Mientras no exista, las
          funciones de IA quedan visibles pero no ejecutan, y aquí no se registrara consumo.
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`Costo de ${nombrePeriodo(periodo)}`} value={formatoUsd(costoPeriodo)} hint="Lo que cuesta la IA este mes" />
        <Stat label="Operaciones del periodo" value={formatNumber(operacionesPeriodo, 0)} hint={`${filas.filter((f) => f.consumo).length} ${filas.filter((f) => f.consumo).length === 1 ? "cuenta" : "cuentas"} con consumo`} />
        <Stat
          label="Ingreso por complemento IA"
          value={`$${formatNumber(ingresoIa, 0)} MXN`}
          hint={`${filas.filter((f) => f.org.iaComplemento).length} ${filas.filter((f) => f.org.iaComplemento).length === 1 ? "cuenta" : "cuentas"} con IA Avanzada`}
          tone={ingresoIa > 0 ? "good" : "default"}
        />
        <Stat
          label="Costo histórico acumulado"
          value={formatoUsd(historico._sum.costoUsd ?? 0)}
          hint={`${formatNumber(historico._count._all, 0)} llamadas · ${formatNumber(((historico._sum.inputTokens ?? 0) + (historico._sum.outputTokens ?? 0)) / 1000, 0)}k tokens`}
        />
      </div>

      {periodos.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <span className="self-center text-[0.6875rem] font-medium text-slate-500">Periodo:</span>
          {periodos.map((p) => (
            <Link
              key={p.periodo}
              href={`/clients/ia?periodo=${p.periodo}`}
              className={`rounded-lg border px-2.5 py-1 text-[0.6875rem] ${
                p.periodo === periodo
                  ? "border-brand-300 bg-brand-50 text-brand-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {nombrePeriodo(p.periodo)}
              <span className="ml-1.5 text-slate-400">{formatoUsd(p._sum.costoUsd ?? 0)}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {filas.every((f) => !f.consumo) ? (
        <EmptyState
          title="Sin consumo registrado en este periodo"
          description="Cuando se genere el primer diagnóstico apareceran aquí los tokens y el costo de cada cuenta."
        />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Plan</th>
                  <th className="text-right">Bolsa del mes</th>
                  <th className="text-right">Llamadas</th>
                  <th className="text-right">Tokens</th>
                  <th className="text-right">Costo real</th>
                  <th className="text-right">Cobro mensual</th>
                  <th className="text-right">Costo / ingreso</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ org, consumo, entitlement, plan, ingresoMensual }) => {
                  // A tipo de cambio de referencia: la comparacion es para ver
                  // el orden de magnitud, no para contabilidad.
                  const costoMxn = (consumo?.costoUsd ?? 0) * 18;
                  const proporcion = ingresoMensual > 0 ? (costoMxn / ingresoMensual) * 100 : 0;
                  return (
                    <tr key={org.id}>
                      <td>
                        <p className="font-medium text-slate-800">{org.name}</p>
                        {consumo?.funciones.length ? (
                          <p className="text-[0.6875rem] text-slate-400">
                            {consumo.funciones
                              .map((f) => `${FUNCIONES_IA[f.funcion as ClaveFuncionIA]?.nombre ?? f.funcion}: ${f.llamadas}`)
                              .join(" · ")}
                          </p>
                        ) : null}
                      </td>
                      <td className="text-xs text-slate-600">
                        {plan.nombre}
                        {org.iaComplemento ? <Badge tone="info" className="ml-1.5">+IA</Badge> : null}
                      </td>
                      <td className="text-right text-xs tabular-nums text-slate-600">
                        {consumo?.operaciones ?? 0} / {entitlement.operaciones || "—"}
                      </td>
                      <td className="text-right text-xs tabular-nums text-slate-600">{consumo?.llamadas ?? 0}</td>
                      <td className="text-right text-xs tabular-nums text-slate-600">
                        {consumo ? formatNumber(consumo.tokens, 0) : "—"}
                      </td>
                      <td className="text-right text-xs font-medium tabular-nums text-slate-800">
                        {formatoUsd(consumo?.costoUsd ?? 0)}
                      </td>
                      <td className="text-right text-xs tabular-nums text-slate-600">
                        ${formatNumber(ingresoMensual, 0)} {org.currency}
                      </td>
                      <td className="text-right text-xs tabular-nums">
                        {ingresoMensual === 0 || !consumo ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <Badge tone={proporcion < 5 ? "success" : proporcion < 20 ? "info" : "warning"}>
                            {proporcion < 0.1 ? "<0.1" : proporcion.toFixed(1)}%
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader
          title="Como se cuenta"
          subtitle="Para que los números de arriba se puedan defender frente a un cliente."
        />
        <div className="grid gap-2 text-xs text-slate-600">
          <p>
            <strong className="text-slate-800">Operación</strong> es la unidad que se le cobra al cliente. Cada
            función cuesta un número fijo de operaciones, sin importar cuantos tokens haya usado: asi el cliente
            puede planear su consumo.
          </p>
          <p>
            <strong className="text-slate-800">Costo real</strong> es lo que factura Anthropic por esa llamada,
            calculado con la tarifa del modelo al momento de ejecutarla y guardado junto al registro. No se
            recalcula después, para que un cambio de precios no altere el historico.
          </p>
          <p>
            <strong className="text-slate-800">Costo / ingreso</strong> compara el costo del mes contra lo que
            paga la cuenta, a un tipo de cambio de referencia de 18 pesos por dolar. Sirve para ver el orden de
            magnitud; no es un dato contable.
          </p>
          <p className="text-slate-500">
            Una llamada que falla no descuenta operaciones al cliente, pero si aparece en el costo: el modelo
            cobra el intento.
          </p>
        </div>
      </Card>
    </>
  );
}
