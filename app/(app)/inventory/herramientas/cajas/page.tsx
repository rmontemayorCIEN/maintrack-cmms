import Link from "next/link";
import { ArrowLeft, Package } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { cajasFuera } from "@/lib/herramientas";
import { formatDate } from "@/lib/utils";
import { ArmarCaja, PrestarCaja, RecibirCaja } from "./acciones";

export const metadata = { title: "Cajas de herramienta" };

/**
 * Las cajas: grupos de herramienta que salen y regresan juntos.
 *
 * Lo primero es lo que está fuera, no el catálogo de cajas: igual que en
 * Herramientas, la pregunta de todos los días es quién trae qué, y sobre todo
 * si alguna regresó incompleta.
 */
export default async function CajasPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const puedeMover = can(user.role, "inventory:write");
  const zona = user.organization.timezone;

  const [cajas, fuera, herramientas, unidades, personas, almacenes] = await Promise.all([
    prisma.kitDeHerramientas.findMany({
      where: { organizationId: orgId },
      include: {
        piezas: {
          include: {
            part: { select: { code: true, name: true } },
            asset: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: [{ activo: "desc" }, { code: "asc" }],
    }),
    cajasFuera(orgId),
    prisma.part.findMany({
      where: { organizationId: orgId, naturaleza: "HERRAMIENTA", active: true },
      select: { id: true, code: true, name: true }, orderBy: { code: "asc" },
    }),
    prisma.asset.findMany({
      where: { organizationId: orgId, sePresta: true, active: true },
      select: { id: true, code: true, name: true }, orderBy: { code: "asc" },
    }),
    prisma.user.findMany({
      where: { organizationId: orgId, active: true },
      select: { id: true, name: true, jobTitle: true }, orderBy: { name: "asc" },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: orgId, active: true },
      select: { id: true, name: true }, orderBy: { name: "asc" },
    }),
  ]);

  const opcionesPersonas = personas.map((p) => ({ id: p.id, etiqueta: p.name, detalle: p.jobTitle }));
  const opcionesAlmacenes = almacenes.map((a) => ({ id: a.id, nombre: a.name }));
  const incompletas = fuera.filter((c) => c.devueltas > 0);

  return (
    <div>
      <Link href="/inventory/herramientas" className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3 w-3" aria-hidden /> Herramientas
      </Link>

      <PageHeader
        title="Cajas de herramienta"
        description="Grupos que salen y regresan juntos. Lo que importa es saber qué falta cuando una vuelve incompleta."
        actions={
          puedeMover && (herramientas.length || unidades.length) ? (
            <ArmarCaja
              herramientas={herramientas.map((h) => ({ id: h.id, etiqueta: `${h.code} — ${h.name}` }))}
              unidades={unidades.map((u) => ({ id: u.id, etiqueta: `${u.code} — ${u.name}` }))}
            />
          ) : undefined
        }
      />

      {cajas.length ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Cajas" value={String(cajas.filter((c) => c.activo).length)} />
          <Stat label="Fuera" value={String(fuera.length)} hint="Salidas sin cerrar" />
          <Stat
            label="Regresaron incompletas"
            value={String(incompletas.length)}
            tone={incompletas.length ? "warn" : "default"}
            hint="Les falta alguna pieza"
          />
        </div>
      ) : null}

      {fuera.length ? (
        <Card className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Lo que está fuera</h2>
          <div className="space-y-3">
            {fuera.map((c) => (
              <div key={c.grupo} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-slate-800">{c.kit?.code ?? "—"} — {c.kit?.name ?? ""}</span>
                  <span className="text-slate-600">la trae {c.persona.name}</span>
                  <span className="text-slate-400">desde el {formatDate(c.entregadoEl, zona)}</span>
                  {c.devueltas > 0 ? (
                    <Badge tone="warning">regresó incompleta: {c.devueltas} de {c.total}</Badge>
                  ) : null}
                  {c.seTardo ? <Badge tone="warning">{c.dias} días fuera</Badge> : null}
                </div>
                <ul className="mt-1 flex flex-wrap gap-x-3 text-[0.6875rem] text-slate-500">
                  {c.piezas.map((p) => <li key={p.id}>{p.que}</li>)}
                </ul>
                {puedeMover ? <RecibirCaja grupo={c.grupo} piezas={c.piezas} /> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {cajas.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" aria-hidden />}
          title="Todavía no hay cajas armadas"
          description="Una caja es un grupo de herramienta que sale y regresa junto: la del mecánico, la del eléctrico. Se presta de un golpe, y al volver se marca pieza por pieza qué regresó — que es lo único que una caja hace mejor que prestar suelto."
        />
      ) : (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Las cajas</h2>
          <div className="space-y-3">
            {cajas.map((c) => (
              <div key={c.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{c.code} — {c.name}</span>
                  <span className="text-[0.6875rem] text-slate-500">{c.piezas.length} piezas</span>
                  {c.activo ? null : <Badge tone="muted">Apagada</Badge>}
                  {puedeMover && c.activo ? (
                    <span className="ml-auto">
                      <PrestarCaja
                        cajaId={c.id}
                        cajaNombre={`${c.code} — ${c.name}`}
                        personas={opcionesPersonas}
                        almacenes={opcionesAlmacenes}
                      />
                    </span>
                  ) : null}
                </div>
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.6875rem] text-slate-500">
                  {c.piezas.map((p) => (
                    <li key={p.id}>
                      {p.part ? `${p.part.code} — ${p.part.name}` : `${p.asset?.code ?? "?"} — ${p.asset?.name ?? ""}`}
                      {p.cantidad !== 1 ? ` ×${p.cantidad}` : ""}
                    </li>
                  ))}
                </ul>
                {c.notas ? <p className="mt-1 text-[0.6875rem] text-slate-400">{c.notas}</p> : null}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[0.625rem] text-slate-400">
            Si al salir falta una pieza, la caja sale con lo demás y se dice cuál no pudo llevarse: negarla entera
            dejaría al técnico sin nada. Y lo que no regresa sigue a nombre de quien lo trae, para buscarlo o darlo
            de baja.
          </p>
        </Card>
      )}
    </div>
  );
}
