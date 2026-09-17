import { zonaDeLaEmpresa } from "@/lib/indicadores";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { estadoDe } from "@/lib/conjuntos";
import { terminoConjunto } from "@/lib/instalaciones";
import { costoDeParar, esPeriodo, ventanas, type ClavePeriodo } from "@/lib/costo-de-parar";
import { Lienzo } from "./lienzo";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string }>;
};

export default async function ConjuntoPage({ params, searchParams }: Params) {
  const { id } = await params;
  const periodo: ClavePeriodo = esPeriodo((await searchParams).p) ? ((await searchParams).p as ClavePeriodo) : "TRIMESTRE";
  const user = await requireUser();
  const orgId = user.organizationId;
  const termino = terminoConjunto(user.organization);

  const conjunto = await prisma.conjunto.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true, code: true, name: true, descripcion: true,
      responsable: { select: { name: true } },
      equipos: {
        select: {
          planoX: true, planoY: true, planoAncho: true, planoAlto: true,
          asset: {
            select: {
              id: true, code: true, name: true, status: true, criticality: true,
              detieneLinea: true, active: true,
              location: { select: { name: true } },
              category: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!conjunto) notFound();

  // Un equipo retirado conserva su historia dentro del conjunto pero no se
  // dibuja: ocuparia lugar en el lienzo por algo que ya no existe.
  const vivos = conjunto.equipos.filter((e) => e.asset.active);
  const ids = vivos.map((e) => e.asset.id);
  const ahora = new Date();
  const v = ventanas(periodo, ahora, await zonaDeLaEmpresa(orgId));

  const [ordenes, costo, planes] = await Promise.all([
    ids.length
      ? prisma.workOrder.findMany({
          where: { organizationId: orgId, assetId: { in: ids }, status: { notIn: ["CANCELLED"] } },
          select: {
            id: true, number: true, title: true, status: true, priority: true,
            maintenanceType: true, assetId: true, dueDate: true, completedAt: true,
          },
          orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
          take: 200,
        })
      : [],
    // El costo se calcula para toda la organizacion y aqui solo se toman los
    // equipos de este conjunto: la aritmetica honesta —que solo cobra el paro
    // de lo que detiene la linea, a la tarifa de su area— ya vive ahi y no se
    // vuelve a escribir.
    ids.length ? costoDeParar(orgId, v.actual) : null,
    ids.length
      ? prisma.planAsset.findMany({
          where: { organizationId: orgId, assetId: { in: ids }, active: true },
          select: { assetId: true, nextDueDate: true },
        })
      : [],
  ]);

  const porEquipo = new Map(
    (costo?.areas ?? []).flatMap((a) => a.equipos).map((e) => [e.assetId, e]),
  );
  const vencidosPorEquipo = new Map<string, number>();
  for (const p of planes) {
    if (p.nextDueDate && p.nextDueDate < ahora) {
      vencidosPorEquipo.set(p.assetId, (vencidosPorEquipo.get(p.assetId) ?? 0) + 1);
    }
  }
  const abiertasPorEquipo = new Map<string, number>();
  for (const o of ordenes) {
    if (o.assetId && !["COMPLETED", "CLOSED"].includes(o.status)) {
      abiertasPorEquipo.set(o.assetId, (abiertasPorEquipo.get(o.assetId) ?? 0) + 1);
    }
  }

  const abajo = vivos.filter((e) => e.asset.status === "DOWN");
  const aMedias = vivos.filter((e) => e.asset.status === "DEGRADED").length;

  return (
    <div>
      <PageHeader
        title={conjunto.name}
        breadcrumb={
          <Link href="/conjuntos" className="hover:underline">
            {termino.plural}
          </Link>
        }
        description={
          conjunto.descripcion ??
          `${vivos.length} equipo${vivos.length === 1 ? "" : "s"}${
            conjunto.responsable ? ` · responsable: ${conjunto.responsable.name}` : ""
          }`
        }
      />
      <Lienzo
        conjuntoId={conjunto.id}
        nombre={conjunto.name}
        termino={termino}
        moneda={user.organization.currency}
        periodo={periodo}
        estado={estadoDe({ equipos: vivos.length, abajo: abajo.length, aMedias })}
        abajoQueDetienen={abajo.filter((e) => e.asset.detieneLinea === true).length}
        aMedias={aMedias}
        equipos={vivos.map((e) => {
          const c = porEquipo.get(e.asset.id);
          return {
            id: e.asset.id,
            code: e.asset.code,
            name: e.asset.name,
            status: e.asset.status,
            criticality: e.asset.criticality,
            detieneLinea: e.asset.detieneLinea,
            area: e.asset.location?.name ?? null,
            categoriaId: e.asset.category?.id ?? null,
            categoria: e.asset.category?.name ?? null,
            horas: c ? Math.round((c.horas / 60) * 10) / 10 : 0,
            perdida: c?.perdida ?? 0,
            planesVencidos: vencidosPorEquipo.get(e.asset.id) ?? 0,
            ordenesAbiertas: abiertasPorEquipo.get(e.asset.id) ?? 0,
            planoX: e.planoX,
            planoY: e.planoY,
            planoAncho: e.planoAncho,
            planoAlto: e.planoAlto,
          };
        })}
        ordenes={ordenes.map((o) => ({
          ...o,
          dueDate: o.dueDate ? o.dueDate.toISOString() : null,
          completadaEl: o.completedAt ? o.completedAt.toISOString() : null,
        }))}
        editable={can(user.role, "asset:write")}
      />
    </div>
  );
}
