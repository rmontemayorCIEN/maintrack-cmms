import Link from "next/link";
import { Footprints } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { rondinEnCurso } from "@/lib/rondin";
import { formatDateTime } from "@/lib/utils";
import { Recorrido } from "./recorrido";

export const metadata = { title: "Rondines" };

/**
 * Los recorridos por la planta.
 *
 * Arriba, caminar: si hay uno a medias se reanuda, y si no, se empieza. Abajo,
 * los anteriores, que es donde esta el valor a la larga —dos rondines del
 * mismo punto separados por un mes contestan si aquello crecio—.
 */
export default async function RondinesPage() {
  const user = await requireUser();
  const puedeCaminar = can(user.role, "workorder:execute");

  const [enCurso, areas, equipos, anteriores] = await Promise.all([
    puedeCaminar ? rondinEnCurso(user.organizationId, user.id) : Promise.resolve(null),
    prisma.location.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
    // Para poder decir de qué equipo era una parada cuando el sistema no lo
    // dedujo. Se traen todos porque el área se elige al empezar el recorrido,
    // no al cargar la pantalla; el componente filtra por ella.
    prisma.asset.findMany({
      where: { organizationId: user.organizationId, active: true },
      select: { id: true, code: true, name: true, locationId: true },
      orderBy: { code: "asc" },
      take: 500,
    }),
    prisma.rondin.findMany({
      where: { organizationId: user.organizationId, estado: { not: "CANCELADO" } },
      orderBy: { iniciadoEn: "desc" },
      take: 25,
      select: {
        id: true, numero: true, estado: true, iniciadoEn: true,
        location: { select: { name: true } },
        iniciadoPor: { select: { name: true } },
        _count: { select: { paradas: true } },
      },
    }),
  ]);

  const areaDelEnCurso = enCurso?.locationId
    ? areas.find((a) => a.id === enCurso.locationId)?.name ?? null
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rondines"
        description="El recorrido por la planta: lo que se ve, dónde y cuándo. Lo que hoy se queda en el pasillo."
      />

      {puedeCaminar ? (
        <Recorrido
          rondinInicial={enCurso
            ? { id: enCurso.id, numero: enCurso.numero, paradas: enCurso._count.paradas,
                area: areaDelEnCurso, areaId: enCurso.locationId }
            : null}
          areas={areas}
          equipos={equipos}
        />
      ) : (
        // Consulta entra a mirar, no a caminar: anotar paradas exige el mismo
        // permiso que ejecutar trabajo.
        <Card>
          <p className="text-xs text-slate-600">
            Su perfil puede consultar los recorridos, pero no registrarlos.
          </p>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Recorridos anteriores</h2>
        {anteriores.length === 0 ? (
          <EmptyState
            icon={<Footprints className="h-6 w-6" aria-hidden />}
            title="Todavía no hay recorridos"
            description="El primero siembra la ruta: las paradas de hoy sirven de referencia para comparar las de la próxima vez."
          />
        ) : (
          <div className="grid gap-2">
            {anteriores.map((r) => (
              <Link
                key={r.id}
                href={`/rondines/${r.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-brand-300 hover:bg-brand-50/40"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{r.numero}</p>
                  <p className="truncate text-[0.6875rem] text-slate-500">
                    {r.location?.name ?? "Toda la planta"} · {r.iniciadoPor?.name ?? "—"} · {formatDateTime(r.iniciadoEn)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-slate-600">{r._count.paradas} parada(s)</span>
                  {r.estado === "EN_CURSO" ? <Badge tone="warning">En curso</Badge> : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
