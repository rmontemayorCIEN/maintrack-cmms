import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { estadoDe } from "@/lib/conjuntos";
import { terminoConjunto } from "@/lib/instalaciones";
import { Lienzo } from "./lienzo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export default async function ConjuntoPage({ params }: Params) {
  const { id } = await params;
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
              category: { select: { name: true } },
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

  const ordenes = vivos.length
    ? await prisma.workOrder.findMany({
        where: {
          organizationId: orgId,
          assetId: { in: vivos.map((e) => e.asset.id) },
          status: { notIn: ["CANCELLED"] },
        },
        select: {
          id: true, number: true, title: true, status: true, priority: true,
          maintenanceType: true, assetId: true, dueDate: true, completedAt: true,
        },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        take: 150,
      })
    : [];

  const abajo = vivos.filter((e) => e.asset.status === "DOWN");
  const aMedias = vivos.filter((e) => e.asset.status === "DEGRADED").length;
  const estado = estadoDe({ equipos: vivos.length, abajo: abajo.length, aMedias });

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
        estado={estado}
        abajoQueDetienen={abajo.filter((e) => e.asset.detieneLinea === true).length}
        aMedias={aMedias}
        equipos={vivos.map((e) => ({
          id: e.asset.id,
          code: e.asset.code,
          name: e.asset.name,
          status: e.asset.status,
          criticality: e.asset.criticality,
          detieneLinea: e.asset.detieneLinea,
          area: e.asset.location?.name ?? null,
          categoria: e.asset.category?.name ?? null,
          planoX: e.planoX,
          planoY: e.planoY,
          planoAncho: e.planoAncho,
          planoAlto: e.planoAlto,
        }))}
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
