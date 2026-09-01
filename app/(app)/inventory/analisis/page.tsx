import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowDown, ArrowUp, Clock, PackageX, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { analizarAlmacen } from "@/lib/almacen-analisis";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { iaConfigurada } from "@/lib/ia/cliente";
import { iaDeLaOrganizacion } from "@/lib/planes";
import { SugerenciasIa } from "./sugerencias";

export const metadata = { title: "Analisis de almacen" };
export const dynamic = "force-dynamic";

/**
 * Analisis del almacen sobre datos propios.
 *
 * Todo lo que se muestra aqui sale del kardex y de los planes del cliente: no
 * hay estimacion ni modelo de por medio. Cada cifra se puede rastrear hasta un
 * movimiento de almacen, y esa es la razon de que esta pantalla exista
 * separada de lo que propone la inteligencia artificial.
 */
export default async function AnalisisAlmacenPage() {
  const user = await requireUser();
  const [a, activos] = await Promise.all([
    analizarAlmacen(user.organizationId),
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: {
        id: true, code: true, name: true, criticality: true,
        _count: { select: { workOrders: true } },
      },
      orderBy: [{ criticality: "asc" }, { code: "asc" }],
    }),
  ]);

  const puedeSugerir =
    iaConfigurada() &&
    can(user.role, "inventory:write") &&
    iaDeLaOrganizacion(user.organization).funciones.includes("REFACCIONES");
  const moneda = user.organization.currency;
  const t = a.totales;

  const hayHallazgos =
    a.bajoMinimo.length + a.faltantesDePlan.length + a.minimosSugeridos.length +
    a.sinControl.length + a.inmovilizado.length > 0;

  return (
    <>
      <PageHeader
        title="Analisis de almacen"
        description="Que le falta, que sobra y que minimos no corresponden a su consumo real. Todo calculado sobre su kardex y sus planes: ni una sola estimacion."
        breadcrumb={
          <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Almacen
          </Link>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Valor del inventario" value={formatCurrency(t.valorInventario, moneda)} hint={`${t.refacciones} refacciones activas`} />
        <Stat
          label="Reponer lo desabastecido"
          value={formatCurrency(t.costoDeReponerMinimos, moneda)}
          hint={`${a.bajoMinimo.length} bajo su minimo`}
          tone={a.bajoMinimo.length ? "warn" : "good"}
        />
        <Stat
          label="Surtir lo que piden los planes"
          value={formatCurrency(t.costoDeSurtirFaltantes, moneda)}
          hint={`${a.faltantesDePlan.length} sin existencia suficiente`}
          tone={a.faltantesDePlan.length ? "bad" : "good"}
        />
        <Stat
          label="Dinero que puede liberar"
          value={formatCurrency(t.dineroLiberable + t.valorInmovilizado, moneda)}
          hint="Minimos inflados e inventario sin movimiento"
          tone={t.dineroLiberable + t.valorInmovilizado > 0 ? "warn" : "good"}
        />
      </div>

      {!hayHallazgos ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-sm font-semibold text-slate-800">El almacen esta en orden</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
              No hay refacciones bajo minimo, los planes tienen con que ejecutarse y los minimos corresponden
              al consumo. Vuelva a revisar despues de unas semanas de movimiento.
            </p>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4">
        {a.faltantesDePlan.length ? (
          <Card padded={false}>
            <div className="border-b border-slate-200 px-5 py-4">
              <CardHeader
                title="Sus planes piden refacciones que no tiene"
                subtitle="Estas ordenes van a nacer detenidas: el tecnico baja a piso y no hay con que trabajar."
              />
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Refaccion</th><th>Planes que la piden</th>
                    <th className="text-right">Existencia</th><th className="text-right">Piden</th><th className="text-right">Surtir</th>
                  </tr>
                </thead>
                <tbody>
                  {a.faltantesDePlan.map((f) => (
                    <tr key={f.partId}>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <Badge tone={f.criticidadMaxima === "A" ? "danger" : "muted"}>{f.criticidadMaxima}</Badge>
                          <div>
                            <p className="font-medium text-slate-800">{f.codigo}</p>
                            <p className="text-xs text-slate-500">{f.nombre}</p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-64 text-xs text-slate-600">{f.planes.join(" · ")}</td>
                      <td className="text-right tabular-nums text-xs text-slate-600">{formatNumber(f.existencia, 1)} {f.unidad}</td>
                      <td className="text-right tabular-nums text-xs text-slate-600">{formatNumber(f.requerido, 1)}</td>
                      <td className="text-right text-xs font-medium tabular-nums text-slate-800">{formatCurrency(f.costoDeSurtir, moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {a.bajoMinimo.length ? (
          <Card padded={false}>
            <div className="border-b border-slate-200 px-5 py-4">
              <CardHeader
                title="Por debajo de su minimo"
                subtitle="Ordenadas por criticidad del equipo que las consume, y con el tiempo de entrega del proveedor."
                action={<PackageX className="h-4 w-4 text-amber-500" />}
              />
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Refaccion</th><th className="text-right">Hay</th><th className="text-right">Minimo</th>
                    <th className="text-right">Faltan</th><th>Proveedor</th><th className="text-right">Reponer</th>
                  </tr>
                </thead>
                <tbody>
                  {a.bajoMinimo.map((b) => (
                    <tr key={b.partId}>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {b.criticidad ? <Badge tone={b.criticidad === "A" ? "danger" : "muted"}>{b.criticidad}</Badge> : null}
                          <div>
                            <p className="font-medium text-slate-800">{b.codigo}</p>
                            <p className="text-xs text-slate-500">{b.nombre}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`text-right tabular-nums text-xs ${b.existencia === 0 ? "font-semibold text-red-600" : "text-slate-600"}`}>
                        {formatNumber(b.existencia, 1)}
                      </td>
                      <td className="text-right tabular-nums text-xs text-slate-500">{formatNumber(b.minimo, 1)}</td>
                      <td className="text-right tabular-nums text-xs text-slate-700">{formatNumber(b.faltante, 1)} {b.unidad}</td>
                      <td className="text-xs text-slate-600">
                        {b.proveedor ?? <span className="text-amber-600">sin proveedor</span>}
                        <span className="ml-1 text-slate-400">· {b.diasDeEntrega} d</span>
                      </td>
                      <td className="text-right text-xs font-medium tabular-nums text-slate-800">{formatCurrency(b.costoDeReponer, moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {a.minimosSugeridos.length ? (
          <Card padded={false}>
            <div className="border-b border-slate-200 px-5 py-4">
              <CardHeader
                title="Minimos que no corresponden al consumo"
                subtitle="El minimo util es el que alcanza para una intervencion completa y para cubrir el tiempo de entrega. Por debajo se arriesga un paro; muy por encima es dinero detenido en el anaquel."
              />
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Refaccion</th><th className="text-right">Minimo</th><th className="text-right">Sugerido</th>
                    <th className="text-right">Consumo</th><th className="text-right">Entrega</th><th className="text-right">Efecto</th>
                  </tr>
                </thead>
                <tbody>
                  {a.minimosSugeridos.map((m) => (
                    <tr key={m.partId}>
                      <td>
                        <p className="font-medium text-slate-800">{m.codigo}</p>
                        <p className="text-xs text-slate-500">{m.nombre}</p>
                      </td>
                      <td className="text-right tabular-nums text-xs text-slate-500">{formatNumber(m.minimoActual, 1)}</td>
                      <td className="text-right">
                        <span className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
                          m.direccion === "SUBIR" ? "text-amber-700" : "text-slate-700"
                        }`}>
                          {m.direccion === "SUBIR" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                          {formatNumber(m.minimoSugerido, 1)} {m.unidad}
                        </span>
                      </td>
                      <td className="text-right tabular-nums text-xs text-slate-600">{formatNumber(m.consumoMensual, 1)}/mes</td>
                      <td className="text-right tabular-nums text-xs text-slate-500">{m.diasDeEntrega} d</td>
                      <td className="text-right text-xs tabular-nums">
                        {m.direccion === "SUBIR" ? (
                          <span className="text-amber-700">evita desabasto</span>
                        ) : (
                          <span className="text-slate-700">libera {formatCurrency(m.dineroLiberado, moneda)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {a.sinControl.length ? (
            <Card>
              <CardHeader
                title="Se consumen sin minimo definido"
                subtitle="Salen del almacen pero nunca disparan alerta de reposicion: se van a acabar sin avisar."
                action={<AlertTriangle className="h-4 w-4 text-amber-500" />}
              />
              <ul className="grid gap-1.5">
                {a.sinControl.map((s) => (
                  <li key={s.partId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-slate-700">{s.codigo} — {s.nombre}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      {s.salidas} salidas · {formatNumber(s.cantidadConsumida, 1)} {s.unidad}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {a.inmovilizado.length ? (
            <Card>
              <CardHeader
                title="Sin movimiento en seis meses"
                subtitle={`${formatCurrency(t.valorInmovilizado, moneda)} detenidos. Revise si siguen respaldando algun equipo o si ya son obsoletos.`}
                action={<Clock className="h-4 w-4 text-slate-400" />}
              />
              <ul className="grid gap-1.5">
                {a.inmovilizado.slice(0, 10).map((i) => (
                  <li key={i.partId} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate text-slate-700">{i.codigo} — {i.nombre}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      {formatNumber(i.existencia, 1)} {i.unidad} · {formatCurrency(i.valor, moneda)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {a.sinProveedor.length ? (
            <Card>
              <CardHeader
                title="Sin proveedor asignado"
                subtitle="No se pueden reponer sin buscar a quien comprarle."
                action={<Wallet className="h-4 w-4 text-slate-400" />}
              />
              <ul className="grid gap-1">
                {a.sinProveedor.slice(0, 12).map((s) => (
                  <li key={s.codigo} className="truncate text-xs text-slate-700">{s.codigo} — {s.nombre}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      <SugerenciasIa
        disponible={puedeSugerir}
        activos={activos.map((x) => ({
          id: x.id, code: x.code, name: x.name, criticality: x.criticality,
          conRefacciones: x._count.workOrders,
        }))}
      />

      <p className="mt-5 max-w-3xl text-xs text-slate-500">
        <strong className="text-slate-700">Estos numeros salen de sus datos, no de un modelo.</strong>{" "}
        El consumo se mide sobre las salidas de los ultimos seis meses, el tiempo de entrega viene de cada
        proveedor y lo que piden los planes sale de los recursos capturados en sus actividades. Si algo no
        cuadra, el kardex de cada refaccion tiene el movimiento que lo explica.
      </p>
    </>
  );
}
