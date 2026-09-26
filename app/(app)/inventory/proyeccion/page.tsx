import Link from "next/link";
import { AlertTriangle, ArrowLeft, CalendarClock, PackageSearch } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { PERIODOS_CONSUMO, consumoProyectado, esPeriodoConsumo, faltantePara, type PeriodoConsumo } from "@/lib/consumo-proyectado";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const metadata = { title: "Lo que va a pedir el preventivo" };
export const dynamic = "force-dynamic";

const HORIZONTES = [
  { dias: 90, etiqueta: "3 meses" },
  { dias: 180, etiqueta: "6 meses" },
  { dias: 365, etiqueta: "1 año" },
];

/**
 * Qué refacciones va a pedir el mantenimiento preventivo, y cuándo.
 *
 * Sale de cruzar el calendario de lo que va a pasar con el consumo que cada
 * actividad tiene cargado. Las dos cosas ya existían por separado; esta
 * pantalla es la primera que las junta.
 *
 * ── La cobertura va arriba, no al pie ──
 *
 * Si los planes no tienen refacciones cargadas, la tabla sale vacía y eso se
 * lee como «no hay que comprar nada», que es lo contrario de la verdad. La
 * cobertura se dice antes que la cifra, y cuando es baja se dice fuerte.
 */
export default async function ProyeccionPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; periodo?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const dias = HORIZONTES.some((h) => h.dias === Number(params.dias)) ? Number(params.dias) : 90;
  const periodo: PeriodoConsumo = params.periodo && esPeriodoConsumo(params.periodo) ? params.periodo : "mes";
  const moneda = user.organization.currency;

  const r = await consumoProyectado(user.organizationId, { dias, periodo });
  const { cobertura } = r;
  // La señal es el PLAN sin nada, no la actividad: casi ninguna actividad de
  // revisión consume refacciones, y contarlas así pintaba de rojo a una
  // empresa que lo tenía todo bien capturado.
  const sinNada = cobertura.planesSinRefacciones;
  const porcentaje = cobertura.planes ? Math.round((cobertura.planesConRefacciones / cobertura.planes) * 100) : 0;
  const liga = (p: { dias?: number; periodo?: PeriodoConsumo }) =>
    `/inventory/proyeccion?dias=${p.dias ?? dias}&periodo=${p.periodo ?? periodo}`;

  return (
    <div>
      <PageHeader
        title="Lo que va a pedir el preventivo"
        breadcrumb={<Link href="/inventory" className="inline-flex items-center gap-1 hover:text-brand-600"><ArrowLeft className="h-3 w-3" /> Almacén</Link>}
        description="Las refacciones que los planes van a consumir en los próximos meses, con la fecha en que tocan. Sirve para comprar antes de que haga falta, no cuando ya paró el equipo."
        actions={
          <div className="flex flex-wrap gap-1">
            {HORIZONTES.map((h) => (
              <Link key={h.dias} href={liga({ dias: h.dias })}
                className={`rounded-lg border px-2.5 py-1.5 text-xs ${dias === h.dias ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                {h.etiqueta}
              </Link>
            ))}
          </div>
        }
      />

      {/* La cobertura primero: sin ella la tabla miente por omisión. */}
      {cobertura.actividades === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-8 w-8" aria-hidden />}
          title="No hay trabajo preventivo proyectado en este plazo"
          description="Esta pantalla parte de los planes por calendario con equipos asignados y fecha próxima. Cuando existan, aquí aparece lo que van a consumir."
        />
      ) : (
        <>
          <div className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            porcentaje >= 80 ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : porcentaje >= 30 ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-amber-300 bg-amber-100 text-amber-950"
          }`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">
                {cobertura.planesConRefacciones} de {cobertura.planes} planes dicen qué consumen ({porcentaje}%).
              </p>
              {sinNada.length ? (
                <p className="mt-0.5">
                  {sinNada.length === 1 ? "Este plan no tiene" : `Estos ${sinNada.length} planes no tienen`} ninguna
                  refacción cargada, así que lo que pidan no aparece abajo: {sinNada.slice(0, 4).join(", ")}
                  {sinNada.length > 4 ? ` y ${sinNada.length - 4} más` : ""}. Puede ser que de verdad no consuman nada
                  —revisar, medir y limpiar no gastan material— o que falte capturarlo en «Recursos» de cada actividad.
                  Mientras tanto, la cifra de abajo es un piso.{" "}
                  <Link href="/plans" className="underline underline-offset-2">Ver planes</Link>
                </p>
              ) : (
                <p className="mt-0.5">
                  Todos los planes proyectados tienen su consumo cargado. De sus {cobertura.actividades} actividades,{" "}
                  {cobertura.actividadesConRefacciones} piden material; las demás son de revisión y no gastan.
                </p>
              )}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Refacciones distintas" value={String(r.renglones.length)} hint="Las que el plan va a pedir" />
            <Stat label="Piezas en total" value={formatNumber(r.total, 0)} />
            <Stat label="Costo estimado" value={formatCurrency(r.costoTotal, moneda)} hint="Al costo actual del catálogo" />
            <Stat label="Equipos con trabajo" value={String(cobertura.equipos)} />
          </div>

          <Card>
            <CardHeader
              title="Por refacción y por periodo"
              subtitle="Ordenadas por lo que más pesa en dinero. «Falta» es lo que no alcanza con lo que hay hoy, contando el mínimo."
              action={
                <div className="flex gap-1">
                  {(Object.keys(PERIODOS_CONSUMO) as PeriodoConsumo[]).map((k) => (
                    <Link key={k} href={liga({ periodo: k })}
                      className={`rounded-lg border px-2 py-1 text-xs ${periodo === k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                      {PERIODOS_CONSUMO[k].etiqueta}
                    </Link>
                  ))}
                </div>
              }
            />
            {r.renglones.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                <PackageSearch className="mr-1 inline h-4 w-4" aria-hidden />
                Ninguna de las actividades proyectadas tiene refacciones cargadas todavía.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Refacción</th>
                      <th className="num">Hay</th>
                      <th className="num">Mín.</th>
                      {r.columnas.map((c) => <th key={c.clave} className="num">{c.etiqueta}</th>)}
                      <th className="num">Total</th>
                      <th className="num">Falta</th>
                      <th className="num">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.renglones.map((x) => {
                      const falta = faltantePara(x, r.columnas.length - 1);
                      return (
                        <tr key={x.partId}>
                          <td>
                            <Link href={`/inventory/${x.partId}`} className="font-medium hover:underline">{x.code}</Link>
                            <span className="block text-xs text-slate-500">{x.name}</span>
                            <span className="block text-[0.625rem] text-slate-400">{x.equipos.join(" · ")}</span>
                          </td>
                          <td className="num">{formatNumber(x.existencia, 0)}</td>
                          <td className="num text-slate-500">{formatNumber(x.minimo, 0)}</td>
                          {x.porPeriodo.map((v, i) => (
                            <td key={i} className="num">{v ? formatNumber(v, 0) : "—"}</td>
                          ))}
                          <td className="num font-medium">{formatNumber(x.total, 0)} {x.unit}</td>
                          <td className="num">
                            {falta > 0 ? <Badge tone="warning">{formatNumber(falta, 0)}</Badge> : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="num">{formatCurrency(x.costoTotal, moneda)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[0.625rem] text-slate-400">
              Esto es lo que el PLAN compromete, no el consumo total del almacén: lo correctivo no se puede proyectar
              porque una falla no tiene fecha. Comprar exactamente esta cantidad deja sin margen el día que algo se rompa.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
