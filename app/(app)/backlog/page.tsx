import Link from "next/link";
import { PackageX, PackageCheck, Clock } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { backlog } from "@/lib/backlog";
import { MOTIVOS_LIBERACION } from "@/lib/backlog";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * El trabajo que quedo pendiente.
 *
 * No es una bandeja mas: es lo que el equipo intento hacer y no pudo, con la
 * razon. Por eso se ordena por antiguedad y se marca lo que ya se puede
 * ejecutar —una actividad trabada tres semanas por una refaccion que ya llego
 * es justo lo que se pierde de vista sin una lista asi.
 */
export default async function BacklogPage() {
  const user = await requireUser();
  const items = await backlog(user.organizationId);

  const listas = items.filter((i) => i.yaSePuede === true);
  const porActivo = items.reduce<Record<string, typeof items>>((acc, item) => {
    const clave = item.workOrder.asset
      ? `${item.workOrder.asset.code} — ${item.workOrder.asset.name}`
      : "Sin activo asignado";
    (acc[clave] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Trabajo pendiente"
        description="Actividades que se liberaron de una orden porque no se pudieron hacer. Siguen esperando a que otra orden las retome."
      />

      {items.length === 0 ? (
        <Card>
          <p className="px-3 py-10 text-center text-sm text-slate-500">
            No hay trabajo pendiente. Todo lo que se abrio en una orden se resolvio ahi.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <div className="flex items-center gap-3 px-1 py-2">
                <PackageX className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="text-xl font-semibold text-slate-800">{items.length}</p>
                  <p className="text-xs text-slate-500">actividades esperando</p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3 px-1 py-2">
                <PackageCheck className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-xl font-semibold text-slate-800">{listas.length}</p>
                  <p className="text-xs text-slate-500">ya se pueden hacer</p>
                </div>
              </div>
            </Card>
            <Card>
              <div className="flex items-center gap-3 px-1 py-2">
                <Clock className="h-5 w-5 text-slate-500" />
                <div>
                  <p className="text-xl font-semibold text-slate-800">
                    {items.length ? Math.max(...items.map((i) => i.diasEsperando)) : 0}
                  </p>
                  <p className="text-xs text-slate-500">días de la mas vieja</p>
                </div>
              </div>
            </Card>
          </div>

          {Object.entries(porActivo).map(([activo, tareas]) => (
            <Card key={activo}>
              <CardHeader
                title={activo}
                subtitle={`${tareas.length} actividad(es) esperando`}
              />
              <ul className="grid gap-2">
                {tareas.map((t) => (
                  <li
                    key={t.id}
                    className="rounded-lg border border-slate-200 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">{t.title}</p>
                      {t.yaSePuede === true ? (
                        <Badge tone="success">Ya se puede hacer</Badge>
                      ) : null}
                      {t.origen === "PLAN" ? <Badge tone="muted">De un plan</Badge> : null}
                      {t.origen === "SOLICITUD" ? <Badge tone="muted">De una solicitud</Badge> : null}
                    </div>

                    {t.description ? (
                      <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>
                    ) : null}

                    <p className="mt-1.5 text-xs text-amber-800">
                      {MOTIVOS_LIBERACION[t.motivoLiberacion as keyof typeof MOTIVOS_LIBERACION] ??
                        t.motivoLiberacion}
                      {t.motivoDetalle ? ` — ${t.motivoDetalle}` : ""}
                      {t.bloqueadaPor
                        ? ` · ${t.bloqueadaPor.code} ${t.bloqueadaPor.name}` +
                          ` (hay ${t.bloqueadaPor.quantityOnHand} ${t.bloqueadaPor.unit})`
                        : ""}
                    </p>

                    {t.conEquivalente ? (
                      <p className="mt-1 text-xs text-emerald-800">
                        Se puede resolver con{" "}
                        <span className="font-medium">
                          {t.conEquivalente.refaccion.code} {t.conEquivalente.refaccion.name}
                        </span>{" "}
                        ({t.conEquivalente.tipo === "EQUIVALENTE" ? "misma pieza, otra marca" : "sustituto"},
                        hay {t.conEquivalente.hay} {t.conEquivalente.refaccion.unit})
                        {t.conEquivalente.nota ? (
                          <span className="mt-0.5 block text-amber-800">⚠ {t.conEquivalente.nota}</span>
                        ) : null}
                      </p>
                    ) : null}

                    <p className="mt-1 text-xs text-slate-400">
                      Liberada hace {t.diasEsperando} dia(s)
                      {t.liberadaPor?.name ? ` por ${t.liberadaPor.name}` : ""} · viene de{" "}
                      <Link
                        href={`/work-orders/${t.workOrder.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {t.workOrder.number}
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
