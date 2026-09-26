import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { MESES, comparativoDePresupuesto } from "@/lib/presupuestos";
import { zonaDeLaEmpresa } from "@/lib/indicadores";
import { TablaPresupuesto } from "./tabla-presupuesto";

export const dynamic = "force-dynamic";
export const metadata = { title: "Presupuestos" };

/**
 * Cuanto se puede gastar, contra cuanto se lleva gastado.
 *
 * Se captura donde se compara: quien ajusta un presupuesto lo hace mirando el
 * gasto, no en otra pantalla. El año completo es de solo lectura —ahi se ve la
 * curva— y la captura vive en el mes, que es la unidad en que se presupuesta.
 */
export default async function PresupuestosPage({
  searchParams,
}: {
  searchParams: Promise<{ anio?: string; mes?: string }>;
}) {
  const { anio: anioParam, mes: mesParam } = await searchParams;
  const user = await requireUser();
  const moneda = user.organization.currency;
  const zona = await zonaDeLaEmpresa(user.organizationId);

  const hoy = new Date();
  const anioActual = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric" }).format(hoy),
  );
  const mesActual = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: zona, month: "2-digit" }).format(hoy),
  );

  const anio = Number.isInteger(Number(anioParam)) && Number(anioParam) >= 2000 && Number(anioParam) <= 2100
    ? Number(anioParam)
    : anioActual;
  // «anio» vale para el año completo; si no, el mes que se pida, o el de hoy.
  const mes = mesParam === "anio"
    ? null
    : Number.isInteger(Number(mesParam)) && Number(mesParam) >= 1 && Number(mesParam) <= 12
      ? Number(mesParam)
      : mesActual;

  const datos = await comparativoDePresupuesto(user.organizationId, {
    anio, zona, desdeMes: mes ?? 1, hastaMes: mes ?? 12,
  });
  const puedeCapturar = can(user.role, "settings:write");

  const liga = (a: number, m: number | "anio") => `/presupuestos?anio=${a}&mes=${m}`;
  const tonoEjercido = datos.totales.ejercido === null
    ? undefined
    : datos.totales.ejercido > 100 ? ("bad" as const)
      : datos.totales.ejercido >= 90 ? ("warn" as const) : ("good" as const);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Presupuestos"
        description="Cuánto se puede gastar en cada centro de costo, contra lo que de verdad se lleva gastado. Cuenta el costo de las órdenes terminadas en el periodo."
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex overflow-hidden rounded-lg border border-slate-200">
          {[anio - 1, anio, anio + 1].map((a) => (
            <Link
              key={a}
              href={liga(a, mes ?? "anio")}
              className={`px-3 py-1.5 text-xs ${a === anio ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {a}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <Link
            href={liga(anio, "anio")}
            aria-current={mes === null ? "page" : undefined}
            className={`inline-flex min-h-8 items-center rounded-lg border px-2.5 text-xs ${
              mes === null ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            Todo el año
          </Link>
          {MESES.map((nombre, i) => (
            <Link
              key={nombre}
              href={liga(anio, i + 1)}
              aria-current={mes === i + 1 ? "page" : undefined}
              className={`inline-flex min-h-8 items-center rounded-lg border px-2.5 text-xs capitalize ${
                mes === i + 1 ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {nombre.slice(0, 3)}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Presupuesto" value={formatCurrency(datos.totales.presupuesto, moneda)} />
        <Stat label="Gastado" value={formatCurrency(datos.totales.gastado, moneda)} />
        <Stat
          label={datos.totales.diferencia < 0 ? "Rebasado por" : "Disponible"}
          value={formatCurrency(Math.abs(datos.totales.diferencia), moneda)}
          tone={datos.totales.diferencia < 0 ? "bad" : "good"}
        />
        <Stat
          label="Ejercido"
          value={datos.totales.ejercido === null ? "—" : `${formatNumber(datos.totales.ejercido, 0)}%`}
          tone={tonoEjercido}
          hint={mes === null ? `Todo ${anio}` : `${MESES[mes - 1]} de ${anio}`}
        />
      </div>

      {/*
        Un centro con gasto y sin presupuesto es el hueco que importa: se dice
        con nombre, porque si solo saliera lo presupuestado ese gasto quedaria
        invisible y el total parecería mejor de lo que es.
      */}
      {datos.sinPresupuestar.length ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            <strong>{datos.sinPresupuestar.length} centro(s) con gasto y sin presupuesto</strong>:{" "}
            {datos.sinPresupuestar.join(", ")}. Ese gasto es real y no se está comparando contra nada.
          </p>
        </Card>
      ) : null}

      {datos.renglones.length === 0 ? (
        <EmptyState
          title="Todavía no hay centros de costo"
          description="Los presupuestos cuelgan del centro de costo. Dé de alta los suyos en Catálogos —con la misma clave que usa su contabilidad— y asígneselos a los equipos."
        />
      ) : (
        <TablaPresupuesto
          renglones={datos.renglones}
          anio={anio}
          mes={mes}
          moneda={moneda}
          puedeCapturar={puedeCapturar}
        />
      )}

      {mes === null ? (
        <p className="text-xs text-slate-500">
          El año completo es de solo lectura: el presupuesto se captura mes por mes. Elija un mes para ajustarlo.
        </p>
      ) : null}
    </div>
  );
}
