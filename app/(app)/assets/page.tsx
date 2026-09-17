import { Wand2 } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import {
  ASSET_STATUS_COLORS,
  ASSET_STATUS_LABELS,
  CRITICALITY_COLORS,
  CRITICALITY_LABELS,
  OPEN_STATUSES,
} from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AssetDialog } from "./asset-dialog";
import { TablaActivos, type FilaActivo } from "./tabla-activos";
import { vistaGuardada } from "@/lib/vistas";

export const metadata = { title: "Activos" };
export const dynamic = "force-dynamic";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; criticality?: string; status?: string; siteId?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const orgId = user.organizationId;

  const [assets, sites, locations, categories] = await Promise.all([
    prisma.asset.findMany({
      where: {
        organizationId: orgId,
        active: true,
        ...(params.criticality ? { criticality: params.criticality } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.siteId ? { siteId: params.siteId } : {}),
        ...(params.q
          ? {
              OR: [
                { name: { contains: params.q } },
                { code: { contains: params.q } },
                { serialNumber: { contains: params.q } },
                { manufacturer: { contains: params.q } },
              ],
            }
          : {}),
      },
      include: {
        site: { select: { name: true } },
        location: { select: { name: true } },
        category: { select: { name: true } },
        parent: { select: { code: true, name: true } },
        _count: { select: { workOrders: true, plans: true, sensors: true, meters: true } },
      },
      orderBy: [{ criticality: "asc" }, { code: "asc" }],
      take: 300,
    }),
    prisma.site.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    prisma.location.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, siteId: true },
    }),
    prisma.assetCategory.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true },
    }),
  ]);

  const openByAsset = await prisma.workOrder.groupBy({
    by: ["assetId"],
    where: { organizationId: orgId, status: { in: OPEN_STATUSES }, assetId: { not: null } },
    _count: { _all: true },
  });
  const openMap = new Map(openByAsset.map((row) => [row.assetId, row._count._all]));

  const vista = vistaGuardada(user.vistasTabla, "activos");

  const filas: FilaActivo[] = assets.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    categoria: a.category?.name ?? null,
    sitio: a.site?.name ?? null,
    ubicacion: a.location?.name ?? null,
    padre: a.parent ? `${a.parent.code} ${a.parent.name}` : null,
    criticality: a.criticality,
    status: a.status,
    manufacturer: a.manufacturer,
    model: a.model,
    serialNumber: a.serialNumber,
    purchaseCost: a.purchaseCost,
    replacementCost: a.replacementCost,
    detieneLinea: a.detieneLinea,
    expectedLifeYears: a.expectedLifeYears,
    commissionedAt: a.commissionedAt?.toISOString() ?? null,
    warrantyExpiry: a.warrantyExpiry?.toISOString() ?? null,
    otAbiertas: openMap.get(a.id) ?? 0,
    planes: a._count.plans,
    sensores: a._count.sensors,
    medidores: a._count.meters,
  }));

  const down = assets.filter((a) => a.status === "DOWN").length;
  const criticalA = assets.filter((a) => a.criticality === "A").length;
  const totalValue = assets.reduce((sum, a) => sum + a.replacementCost, 0);

  return (
    <>
      <PageHeader
        title="Catálogo de activos"
        description="Jerarquia de equipos con criticidad, estado operativo y valor de reposición."
        actions={
          can(user.role, "asset:write") ? (
            <>
              <Link
                href="/assets/levantamiento"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Wand2 className="h-3.5 w-3.5" /> Levantamiento asistido
              </Link>
              <AssetDialog
                sites={sites}
                locations={locations}
                categories={categories}
                puedeGestionarCatalogos={can(user.role, "settings:write")}
              />
            </>
          ) : null
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Activos registrados" value={assets.length} />
        <Stat label="Criticidad A" value={criticalA} hint="Equipos de mayor impacto" />
        <Stat label="Fuera de servicio" value={down} tone={down ? "bad" : "good"} />
        <Stat label="Valor de reposición" value={formatCurrency(totalValue, user.organization.currency)} />
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={params.q ?? ""} className="field max-w-64" placeholder="Buscar por codigo, nombre, serie…" />
        <select name="criticality" defaultValue={params.criticality ?? ""} className="field max-w-44">
          <option value="">Toda criticidad</option>
          {Object.entries(CRITICALITY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select name="status" defaultValue={params.status ?? ""} className="field max-w-44">
          <option value="">Todo estado</option>
          {Object.entries(ASSET_STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select name="siteId" defaultValue={params.siteId ?? ""} className="field max-w-44">
          <option value="">Todos los sitios</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>{site.name}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">
          Filtrar
        </button>
        {can(user.role, "data:export") ? (
          <a
            href="/api/export/assets"
            className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
          >
            Exportar CSV
          </a>
        ) : null}
      </form>

      {assets.length === 0 ? (
        <EmptyState title="Sin activos" description="Registre su primer equipo para comenzar a programar mantenimiento." />
      ) : (
        <TablaActivos activos={filas} vistaInicial={vista} puedeEditar={can(user.role, "asset:write")} />
      )}
    </>
  );
}
