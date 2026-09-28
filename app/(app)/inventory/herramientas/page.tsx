import Link from "next/link";
import { ArrowLeft, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { verCostosDeAlmacen } from "@/lib/pantallas";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { panoramaDeHerramientas, quienTraeQue } from "@/lib/herramientas";
import { nombreDeEstado, MODOS_ENTREGA } from "@/lib/herramientas-tipos";
import { formatDate } from "@/lib/utils";
import { Atrasada, Devolver, Prestar } from "./acciones";

export const metadata = { title: "Herramientas" };

/**
 * El almacén de herramientas.
 *
 * Lo primero que se ve es QUIÉN TRAE QUÉ, y no el catálogo: la pregunta de
 * todos los días no es «cuántas pinzas tengo» sino «quién trae el calibrador».
 * El catálogo va abajo.
 */
export default async function HerramientasPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const puedeMover = can(user.role, "inventory:write");
  const verCostos = verCostosDeAlmacen(user.role);
  const zona = user.organization.timezone;
  const moneda = user.organization.currency;

  const [panorama, porPersona, almacenes, personas] = await Promise.all([
    panoramaDeHerramientas(orgId),
    quienTraeQue(orgId),
    prisma.warehouse.findMany({
      where: { organizationId: orgId, active: true },
      select: { id: true, name: true, autoservicio: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { organizationId: orgId, active: true },
      select: { id: true, name: true, jobTitle: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const dinero = (n: number) =>
    n.toLocaleString("es-MX", { style: "currency", currency: moneda, maximumFractionDigits: 0 });

  return (
    <div>
      <Link href="/inventory" className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3 w-3" aria-hidden /> Almacén
      </Link>

      <PageHeader
        title="Herramientas"
        description="Lo que sale y regresa: quién la tiene, desde cuándo y en qué estado."
        actions={
          puedeMover && panorama.cuantas ? (
            <Prestar
              herramientas={panorama.filas
                .filter((f) => f.libres > 0)
                .map((f) => ({ id: f.id, etiqueta: `${f.code} — ${f.name}`, detalle: `${f.libres} disponible${f.libres === 1 ? "" : "s"}` }))}
              almacenes={almacenes.map((a) => ({ id: a.id, nombre: a.name, autoservicio: a.autoservicio }))}
              personas={personas.map((p) => ({ id: p.id, etiqueta: p.name, detalle: p.jobTitle }))}
            />
          ) : undefined
        }
      />

      {panorama.cuantas === 0 ? (
        <EmptyState
          icon={<Wrench className="h-8 w-8" aria-hidden />}
          title="Todavía no hay herramientas en el catálogo"
          description="Una herramienta se da de alta como cualquier refacción, en Almacén, y se marca como «Herramienta» en vez de «Refacción». La diferencia es que se presta y regresa, en vez de consumirse."
          action={<LinkButton href="/inventory">Ir al almacén</LinkButton>}
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Herramientas" value={String(panorama.cuantas)} />
            <Stat label="Prestadas" value={String(panorama.prestadas)} hint="Fuera del almacén ahora" />
            <Stat
              label="Se tardaron"
              value={String(panorama.atrasadas)}
              tone={panorama.atrasadas ? "warn" : "default"}
              hint="Llevan más de 15 días fuera"
            />
            {verCostos ? <Stat label="Valor del almacén" value={dinero(panorama.valorTotal)} /> : null}
          </div>

          {/* Quién trae qué: la pregunta de todos los días. */}
          <Card className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Quién trae qué</h2>
              {verCostos ? (
                <Link href="/inventory/herramientas/perdidas" className="text-xs text-slate-500 underline hover:text-slate-700">
                  Qué se está perdiendo
                </Link>
              ) : null}
            </div>

            {porPersona.length === 0 ? (
              <p className="text-sm text-slate-500">Nada está fuera del almacén ahora mismo.</p>
            ) : (
              <div className="space-y-4">
                {porPersona.map((p) => (
                  <div key={p.persona.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{p.persona.name}</span>
                      <span className="text-[0.6875rem] text-slate-500">
                        {p.piezas} {p.piezas === 1 ? "pieza" : "piezas"}
                      </span>
                      {verCostos ? <span className="text-[0.6875rem] text-slate-400">{dinero(p.valor)}</span> : null}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {p.cosas.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                          <span className="font-medium text-slate-700">{r.articulo.code} — {r.articulo.name}</span>
                          {r.cantidad !== 1 ? <span className="text-slate-500">×{r.cantidad}</span> : null}
                          <span className="text-slate-400">
                            desde el {formatDate(r.entregadoEl, zona)}
                            {r.proposito ? ` · ${r.proposito}` : ""}
                          </span>
                          {r.estadoSalida ? (
                            <span className="text-slate-400">salió {nombreDeEstado(r.estadoSalida).toLowerCase()}</span>
                          ) : null}
                          {r.seTardo ? <Atrasada dias={r.dias} /> : null}
                          {puedeMover ? (
                            <span className="ml-auto">
                              <Devolver
                                resguardoId={r.id}
                                estadoSalida={r.estadoSalida}
                                quien={p.persona.name}
                                herramienta={`${r.articulo.code} — ${r.articulo.name}`}
                              />
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">El catálogo</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[0.625rem] uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">Herramienta</th>
                    <th className="px-2 py-2 text-right">Tiene</th>
                    <th className="px-2 py-2 text-right">Prestadas</th>
                    <th className="px-2 py-2 text-right">Libres</th>
                    {verCostos ? <th className="px-2 py-2 text-right">Valor</th> : null}
                    <th className="px-2 py-2">Dónde</th>
                  </tr>
                </thead>
                <tbody>
                  {panorama.filas.map((f) => (
                    <tr key={f.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2">
                        <Link href={`/inventory/${f.id}`} className="font-medium text-slate-800 hover:underline">
                          {f.code} — {f.name}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">{f.total}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-600">{f.prestadas || "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {f.libres === 0
                          ? <span className="text-amber-600">0</span>
                          : <span className="text-slate-800">{f.libres}</span>}
                      </td>
                      {verCostos ? <td className="px-2 py-2 text-right tabular-nums text-slate-600">{dinero(f.valor)}</td> : null}
                      <td className="px-2 py-2 text-[0.6875rem] text-slate-500">
                        {f.existencias.map((x) => (
                          <span key={x.warehouseId} className="mr-2 inline-flex items-center gap-1">
                            {x.warehouse.name}
                            {x.warehouse.autoservicio ? <Badge tone="info">autoservicio</Badge> : null}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[0.625rem] text-slate-400">
              Prestar no descuenta la existencia: la herramienta sigue siendo de la empresa y por eso «Tiene» no
              baja. Lo que baja es lo libre. La existencia solo se descuenta cuando algo se da de baja —se perdió,
              se rompió o terminó su vida útil—, y ahí sí entra al kardex con su costo.
              {almacenes.some((a) => a.autoservicio)
                ? ` En los almacenes de ${MODOS_ENTREGA.AUTOSERVICIO.nombre.toLowerCase()} la salida la registra quien se la lleva, así que el aviso de lo no devuelto es lo que sostiene el control.`
                : ""}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
