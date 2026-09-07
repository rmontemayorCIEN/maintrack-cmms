import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ESTADOS_CONTEO, exactitud } from "@/lib/conteos";
import { formatDateTime } from "@/lib/utils";
import { NuevoConteo } from "./nuevo-conteo";

export const metadata = { title: "Conteos cíclicos" };
export const dynamic = "force-dynamic";

export default async function ConteosPage() {
  const user = await requireUser();
  const orgId = user.organizationId;
  const editable = can(user.role, "inventory:write");

  const [conteos, almacenes, familias] = await Promise.all([
    prisma.inventoryCount.findMany({
      where: { organizationId: orgId },
      orderBy: { abiertoEl: "desc" },
      take: 60,
      include: {
        warehouse: { select: { name: true } },
        responsable: { select: { name: true } },
        renglones: { select: { cantidadSistema: true, cantidadContada: true, cantidadAlCerrar: true } },
      },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: orgId, active: true },
      orderBy: [{ esGeneral: "desc" }, { code: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.partCategory.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { code: true, name: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Conteos cíclicos"
        description="Contar el anaquel y cuadrarlo contra el sistema. Cada diferencia deja su ajuste en el kardex, con el folio del conteo."
        breadcrumb={
          <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="h-3 w-3" /> Almacén
          </Link>
        }
        actions={editable && almacenes.length ? <NuevoConteo almacenes={almacenes} familias={familias} /> : undefined}
      />

      {conteos.length === 0 ? (
        <EmptyState
          title="Sin conteos"
          description="Contar unas cuantas familias cada semana descubre las diferencias mientras todavía se pueden explicar."
        />
      ) : (
        <div className="grid gap-3">
          {conteos.map((c) => {
            const ex = exactitud(c.renglones);
            return (
              <Card key={c.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <Link href={`/inventory/conteos/${c.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                      {c.folio}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {c.warehouse.name} · {c.alcance ?? "Todo el almacén"}
                      {c.responsable?.name ? ` · ${c.responsable.name}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ex ? (
                      <Badge tone={ex.porcentaje >= 95 ? "success" : ex.porcentaje >= 85 ? "warning" : "danger"}>
                        {ex.porcentaje}% exactitud
                      </Badge>
                    ) : null}
                    <Badge tone={c.estado === "ABIERTO" ? "warning" : c.estado === "CERRADO" ? "success" : "muted"}>
                      {ESTADOS_CONTEO[c.estado as keyof typeof ESTADOS_CONTEO] ?? c.estado}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-[0.6875rem] text-slate-400">
                  {c.renglones.length} renglones · abierto {formatDateTime(c.abiertoEl)}
                  {c.cerradoEl ? ` · cerrado ${formatDateTime(c.cerradoEl)}` : ""}
                </p>
                {c.nota ? <p className="mt-1 text-xs text-slate-600">{c.nota}</p> : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
