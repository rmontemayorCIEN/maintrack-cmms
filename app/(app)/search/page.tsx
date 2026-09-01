import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import {
  ASSET_STATUS_COLORS,
  ASSET_STATUS_LABELS,
  MAINTENANCE_TYPE_LABELS,
  WO_STATUS_COLORS,
  WO_STATUS_LABELS,
} from "@/lib/constants";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Busqueda" };
export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q } = await searchParams;
  const orgId = user.organizationId;

  if (!q) {
    return (
      <>
        <PageHeader title="Busqueda" />
        <EmptyState title="Escriba un termino" description="Busque ordenes de trabajo, activos o refacciones." />
      </>
    );
  }

  const [workOrders, assets, parts] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        organizationId: orgId,
        OR: [{ number: { contains: q } }, { title: { contains: q } }, { description: { contains: q } }],
      },
      include: { asset: { select: { code: true } } },
      take: 20,
      orderBy: { createdAt: "desc" },
    }),
    prisma.asset.findMany({
      where: {
        organizationId: orgId,
        active: true,
        OR: [
          { code: { contains: q } },
          { name: { contains: q } },
          { serialNumber: { contains: q } },
          { manufacturer: { contains: q } },
          { model: { contains: q } },
        ],
      },
      take: 20,
      orderBy: { code: "asc" },
    }),
    prisma.part.findMany({
      where: {
        organizationId: orgId,
        active: true,
        OR: [{ code: { contains: q } }, { name: { contains: q } }, { description: { contains: q } }],
      },
      take: 20,
      orderBy: { code: "asc" },
    }),
  ]);

  const total = workOrders.length + assets.length + parts.length;

  return (
    <>
      <PageHeader title={`Resultados para "${q}"`} description={`${total} coincidencias`} />

      {total === 0 ? (
        <EmptyState title="Sin resultados" description="Pruebe con otro codigo, nombre o folio." />
      ) : (
        <div className="grid gap-4">
          {workOrders.length ? (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Ordenes de trabajo ({workOrders.length})</h3>
              <ul className="grid gap-2">
                {workOrders.map((wo) => (
                  <li key={wo.id}>
                    <Link href={`/work-orders/${wo.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          <span className="text-brand-600">{wo.number}</span> · {wo.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {MAINTENANCE_TYPE_LABELS[wo.maintenanceType]}
                          {wo.asset ? ` · ${wo.asset.code}` : ""}
                        </p>
                      </div>
                      <Badge className={WO_STATUS_COLORS[wo.status]}>{WO_STATUS_LABELS[wo.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {assets.length ? (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Activos ({assets.length})</h3>
              <ul className="grid gap-2">
                {assets.map((asset) => (
                  <li key={asset.id}>
                    <Link href={`/assets/${asset.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          <span className="text-brand-600">{asset.code}</span> · {asset.name}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {[asset.manufacturer, asset.model, asset.serialNumber].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      <Badge className={ASSET_STATUS_COLORS[asset.status]}>{ASSET_STATUS_LABELS[asset.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {parts.length ? (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Refacciones ({parts.length})</h3>
              <ul className="grid gap-2">
                {parts.map((part) => (
                  <li key={part.id}>
                    <Link href="/inventory" className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/40">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          <span className="text-brand-600">{part.code}</span> · {part.name}
                        </p>
                        <p className="text-xs text-slate-500">{part.category ?? "Sin categoria"}</p>
                      </div>
                      <Badge tone={part.quantityOnHand <= part.minQuantity ? "danger" : "muted"}>
                        {formatNumber(part.quantityOnHand, 0)} {part.unit}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
