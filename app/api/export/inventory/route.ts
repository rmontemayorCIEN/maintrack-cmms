import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { withAuth } from "@/lib/api";
import { toCsv } from "@/lib/utils";

export async function GET() {
  return withAuth("data:export", async ({ orgId, user }) => {
    const parts = await prisma.part.findMany({
      where: { organizationId: orgId },
      include: { supplier: { select: { name: true } } },
      orderBy: { code: "asc" },
      take: 5000,
    });

    const csv = toCsv(
      parts.map((part) => ({
        Codigo: part.code,
        Nombre: part.name,
        Categoria: part.category ?? "",
        Unidad: part.unit,
        Existencia: part.quantityOnHand,
        Minimo: part.minQuantity,
        Maximo: part.maxQuantity,
        CostoUnitario: part.unitCost,
        ValorTotal: part.quantityOnHand * part.unitCost,
        Ubicacion: part.bin ?? "",
        Proveedor: part.supplier?.name ?? "",
        BajoMinimo: part.quantityOnHand <= part.minQuantity ? "Si" : "No",
      })),
    );

    // Llevarse la informacion queda registrado: es de las acciones que hay que
    // poder reconstruir despues —quien bajo que, y cuando—.
    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "Part", entityId: "export",
      action: "EXPORTED",
      summary: `Exportó inventario (${parts.length} renglones)`,
    });

    return new Response(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inventario-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    }) as never;
  }, { esLectura: true });
}
