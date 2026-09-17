import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { CATEGORIAS_PENDIENTE, trabajoPendiente, type CategoriaPendiente } from "@/lib/backlog";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trabajo pendiente" };

/**
 * El trabajo pendiente, completo y separado por lo que le pasa.
 *
 * Antes solo mostraba actividades liberadas: una orden vencida, una en espera
 * o una sin responsable no aparecian aqui aunque fueran justo el trabajo que
 * hay que destrabar. Cada renglon cae en una sola categoria (ver
 * `trabajoPendiente`) y dice de donde viene, cuanto lleva esperando y que
 * sigue. Una actividad suelta no se mezcla con una orden completa.
 */
export default async function BacklogPage() {
  const user = await requireUser();
  const zona = user.organization.timezone || "America/Mexico_City";
  const items = await trabajoPendiente(user.organizationId, { zona });

  const categorias = (Object.keys(CATEGORIAS_PENDIENTE) as CategoriaPendiente[])
    .map((c) => ({ clave: c, ...CATEGORIAS_PENDIENTE[c], items: items.filter((i) => i.categoria === c) }));
  const horas = (xs: typeof items) => xs.reduce((a, i) => a + (i.horas ?? 0), 0);
  const sinEstimado = (xs: typeof items) => xs.filter((i) => i.horas === null).length;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Trabajo pendiente"
        description="Todo lo que falta por hacer: órdenes abiertas y actividades que no se pudieron realizar, separadas por lo que les impide avanzar."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {categorias.map((c) => (
          <a key={c.clave} href={`#${c.clave}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 hover:border-brand-300">
            <p className="text-xl font-semibold tabular-nums text-slate-800">{c.items.length}</p>
            <p className="text-xs font-medium text-slate-600">{c.titulo}</p>
            <p className="text-[0.6875rem] tabular-nums text-slate-400">{formatNumber(horas(c.items), 1)} h estimadas</p>
          </a>
        ))}
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="px-3 py-10 text-center text-sm text-slate-500">No hay trabajo pendiente.</p>
        </Card>
      ) : null}

      {categorias.filter((c) => c.items.length).map((c) => (
        <Card key={c.clave}>
          <div id={c.clave} className="scroll-mt-20">
            <CardHeader
              title={`${c.titulo} (${c.items.length})`}
              subtitle={`${c.descripcion} ${formatNumber(horas(c.items), 1)} h estimadas${sinEstimado(c.items) ? ` · ${sinEstimado(c.items)} sin estimado` : ""}.`}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-3">{c.clave === "ACTIVIDAD_LIBERADA" ? "Actividad" : "Orden"}</th>
                  <th className="py-1.5 pr-3">Origen</th>
                  <th className="py-1.5 pr-3">Activo</th>
                  <th className="py-1.5 pr-3">Prioridad</th>
                  <th className="py-1.5 pr-3 text-right">Horas</th>
                  <th className="py-1.5 pr-3">Motivo</th>
                  <th className="py-1.5 pr-3">Responsable</th>
                  <th className="py-1.5 pr-3 text-right">Antigüedad</th>
                  <th className="py-1.5">Próxima acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {c.items.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="py-2 pr-3">
                      <Link href={`/work-orders/${i.orden.id}`} className="font-medium text-brand-600 hover:underline">
                        {i.tipo === "ORDEN" ? i.orden.number : i.titulo}
                      </Link>
                      {i.tipo === "ORDEN" ? <p className="text-slate-600">{i.titulo}</p> : null}
                      {i.avisos.length ? <p className="text-[0.6875rem] text-amber-700">{i.avisos.join(" · ")}</p> : null}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{i.origen}</td>
                    <td className="py-2 pr-3 text-slate-600">{i.activo ?? <span className="text-slate-400">Sin activo</span>}</td>
                    <td className="py-2 pr-3"><Badge className={PRIORITY_COLORS[i.prioridad]}>{PRIORITY_LABELS[i.prioridad]}</Badge></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{i.horas === null ? <span className="text-slate-400">Sin estimado</span> : `${formatNumber(i.horas, 1)} h`}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      {i.motivo}
                      {i.nota ? <p className="text-emerald-800">{i.nota}</p> : null}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{i.responsable ?? <span className="text-amber-700">Sin asignar</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{i.antiguedadDias} d</td>
                    <td className="py-2">
                      {i.yaSePuede ? <Badge tone="success">Ya se puede hacer</Badge> : null}
                      <p className="text-slate-700">{i.proximaAccion}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
