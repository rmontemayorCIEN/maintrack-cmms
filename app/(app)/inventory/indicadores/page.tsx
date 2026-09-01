import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader, Stat } from "@/components/ui";
import { indicadoresDeAlmacen } from "@/lib/indicadores-almacen";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const metadata = { title: "Indicadores de almacen" };
export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Explica que significa cada cifra. Un indicador sin lectura no se usa. */
function Lectura({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 pt-2">
      <p className="text-[0.6875rem] font-semibold text-slate-700">{titulo}</p>
      <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-500">{children}</p>
    </div>
  );
}

export default async function IndicadoresPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const moneda = user.organization.currency;

  const ventana = [30, 90, 180, 365].includes(Number(params.dias)) ? Number(params.dias) : 90;
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - ventana * 86400000);

  const k = await indicadoresDeAlmacen(user.organizationId, desde, hasta);

  return (
    <>
      <PageHeader
        title="Indicadores de almacén"
        description={`Cómo se está comportando el almacén. Periodo de ${k.dias} días, del ${iso(desde)} al ${iso(hasta)}.`}
        breadcrumb={
          <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Almacén
          </Link>
        }
        actions={
          <div className="flex gap-1">
            {[30, 90, 180, 365].map((d) => (
              <Link key={d} href={`/inventory/indicadores?dias=${d}`}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
                  ventana === d ? "border-brand-300 bg-brand-50 font-medium text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}>
                {d}d
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Nivel de servicio"
          value={k.nivelServicio === null ? "—" : `${k.nivelServicio}%`}
          hint={`${k.renglonesCompletos} de ${k.renglonesPedidos} renglones surtidos completos`}
          tone={k.nivelServicio === null ? "default" : k.nivelServicio >= 95 ? "good" : k.nivelServicio >= 80 ? "warn" : "bad"}
        />
        <Stat
          label="Rotación anualizada"
          value={k.rotacion === null ? "—" : `${formatNumber(k.rotacion, 1)}×`}
          hint={`${formatCurrency(k.valorConsumido, moneda)} consumidos sobre ${formatCurrency(k.valorInventario, moneda)} en piso`}
        />
        <Stat
          label="Exactitud de inventario"
          value={k.exactitudInventario ? `${k.exactitudInventario.porcentaje}%` : "—"}
          hint={k.exactitudInventario ? `conteo ${k.exactitudInventario.folio}` : "sin conteos cerrados"}
          tone={k.exactitudInventario ? (k.exactitudInventario.porcentaje >= 95 ? "good" : k.exactitudInventario.porcentaje >= 85 ? "warn" : "bad") : "default"}
        />
        <Stat
          label="Trabajo de emergencia"
          value={k.tasaUrgencia === null ? "—" : `${k.tasaUrgencia}%`}
          hint={`${k.urgentes} de ${k.totalPeticiones} peticiones con urgencia`}
          tone={k.tasaUrgencia === null ? "default" : k.tasaUrgencia <= 20 ? "good" : k.tasaUrgencia <= 40 ? "warn" : "bad"}
        />
        <Stat
          label="Entrega real de proveedores"
          value={k.diasEntrega === null ? "—" : `${k.diasEntrega} días`}
          hint={`promedio de ${k.comprasRecibidas} compras recibidas`}
        />
        <Stat
          label="Tasa de devolución"
          value={k.tasaDevolucion === null ? "—" : `${k.tasaDevolucion}%`}
          hint={`${formatNumber(k.devuelto, 0)} devueltas de ${formatNumber(k.surtido, 0)} surtidas`}
          tone={k.tasaDevolucion === null ? "default" : k.tasaDevolucion <= 5 ? "good" : k.tasaDevolucion <= 15 ? "warn" : "bad"}
        />
        <Stat
          label="Sin movimiento en el periodo"
          value={String(k.quietas)}
          hint={`${formatCurrency(k.valorQuieto, moneda)} detenidos`}
        />
        <Stat label="Conteos cerrados" value={String(k.conteosCerrados)} hint={`en ${k.dias} días`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="text-sm font-semibold text-slate-800">Cómo leer estos números</p>
          <div className="mt-3 grid gap-3">
            <Lectura titulo="Nivel de servicio">
              De cada diez cosas que mantenimiento pidió, cuántas encontró completas. Es la medida
              de si el almacén le sirve al técnico. Por debajo del 80% el técnico deja de confiar y
              empieza a guardarse sus propias refacciones, que es cuando el inventario se vuelve ficción.
            </Lectura>
            <Lectura titulo="Rotación">
              Cuántas veces al año se consume el equivalente al inventario completo. En refacciones
              de mantenimiento lo normal es bajo —se tiene por si acaso, no para vender— pero una
              rotación cercana a cero es dinero dormido en el anaquel.
            </Lectura>
            <Lectura titulo="Trabajo de emergencia">
              Qué proporción del material se pidió con urgencia. Es un indicador de mantenimiento,
              no de almacén: si sube, el preventivo no está alcanzando y todo se está atendiendo
              cuando ya falló.
            </Lectura>
            <Lectura titulo="Tasa de devolución">
              Cuánto de lo que salió regresó sin usarse. Un poco es sano —significa que se devuelve
              en vez de quedárselo—. Mucho significa que se está pidiendo de más «por si acaso», y
              cada pieza en la caja de un técnico es una pieza que el sistema cree tener.
            </Lectura>
            <Lectura titulo="Exactitud de inventario">
              Del último conteo, cuántos renglones cuadraron. Debajo del 85% las decisiones de
              compra se están tomando sobre cifras que no corresponden al anaquel.
            </Lectura>
          </div>
        </Card>

        <Card padded={false}>
          <div className="px-5 pt-4">
            <p className="text-sm font-semibold text-slate-800">Refacciones por equipo</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Lo que costó en refacciones mantener cada activo en el periodo. Es la cifra que
              justifica reemplazar un equipo en vez de seguir reparándolo.
            </p>
          </div>
          {k.equiposCaros.length === 0 ? (
            <p className="px-5 py-8 text-center text-xs text-slate-400">
              Sin consumo de refacciones contra activos en el periodo.
            </p>
          ) : (
            <div className="table-wrap mt-3">
              <table className="data">
                <thead>
                  <tr><th>Activo</th><th className="text-right">Refacciones</th></tr>
                </thead>
                <tbody>
                  {k.equiposCaros.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/assets/${e.id}`} className="font-medium text-brand-600 hover:underline">{e.code}</Link>
                        <span className="block text-xs text-slate-500">{e.name}</span>
                      </td>
                      <td className="text-right tabular-nums text-xs font-medium text-slate-800">
                        {formatCurrency(e.costo, moneda)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
