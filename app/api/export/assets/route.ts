import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { toCsv } from "@/lib/utils";
import { ASSET_STATUS_LABELS, CRITICALITY_LABELS } from "@/lib/constants";

export async function GET() {
  return withAuth(null, async ({ orgId }) => {
    const assets = await prisma.asset.findMany({
      where: { organizationId: orgId },
      include: {
        site: { select: { name: true } },
        location: { select: { name: true } },
        category: { select: { name: true } },
      },
      orderBy: { code: "asc" },
      take: 5000,
    });

    const csv = toCsv(
      assets.map((asset) => ({
        Codigo: asset.code,
        Nombre: asset.name,
        Categoria: asset.category?.name ?? "",
        Sitio: asset.site.name,
        Ubicacion: asset.location?.name ?? "",
        Fabricante: asset.manufacturer ?? "",
        Modelo: asset.model ?? "",
        Serie: asset.serialNumber ?? "",
        Criticidad: CRITICALITY_LABELS[asset.criticality],
        Estado: ASSET_STATUS_LABELS[asset.status],
        FechaCompra: asset.purchaseDate?.toISOString().slice(0, 10) ?? "",
        CostoAdquisicion: asset.purchaseCost,
        CostoReposicion: asset.replacementCost,
        FinGarantia: asset.warrantyExpiry?.toISOString().slice(0, 10) ?? "",
        Activo: asset.active ? "Si" : "No",
      })),
    );

    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="activos-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    }) as never;
  });
}
