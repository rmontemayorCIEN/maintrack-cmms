import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { almacenPorOmision } from "@/lib/almacen";
import { ErrorDeCompra, crearRequisicionDeCompra } from "@/lib/compras";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  warehouseId: z.string().optional().nullable(),
  materialRequestId: z.string().optional().nullable(),
  proveedorSugeridoId: z.string().optional().nullable(),
  urgencia: z.enum(["NORMAL", "ALTA", "PARO"]).default("NORMAL"),
  justificacion: z.string().trim().max(500).optional().nullable(),
  renglones: z.array(
    z.object({
      partId: z.string().optional().nullable(),
      descripcion: z.string().trim().min(2).max(200),
      cantidadSolicitada: z.coerce.number().positive(),
      costoEstimado: z.coerce.number().min(0).default(0),
      nota: z.string().trim().max(200).optional().nullable(),
      /** El renglon del vale que quedo faltante, para no comprarlo dos veces. */
      materialRequestLineId: z.string().optional().nullable(),
    }),
  ).min(1).max(80),
});

export async function POST(request: Request) {
  return withAuth("purchase:request", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const warehouseId = input.warehouseId || (await almacenPorOmision(orgId))?.id;
    if (!warehouseId) return fail("La cuenta no tiene ningún almacén activo", 409);

    const almacen = await prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: orgId },
      select: { id: true },
    });
    if (!almacen) return fail("Almacén no encontrado", 404);

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { montoAutorizacion: true },
    });

    try {
      const req = await crearRequisicionDeCompra({
        organizationId: orgId,
        userId: user.id,
        warehouseId: almacen.id,
        materialRequestId: input.materialRequestId,
        proveedorSugeridoId: input.proveedorSugeridoId,
        urgencia: input.urgencia,
        justificacion: input.justificacion,
        montoAutorizacion: org?.montoAutorizacion ?? 0,
        renglones: input.renglones,
      });

      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "PurchaseRequest", entityId: req.id, action: "CREATED",
        summary: `Requisicion de compra ${req.folio}: ${input.renglones.length} renglones, $${req.montoEstimado.toFixed(2)}` +
          (req.estado === "AUTORIZADA" ? " (autorizada automáticamente: bajo el umbral)" : ""),
      });

      return ok({ id: req.id, folio: req.folio, estado: req.estado }, 201);
    } catch (error) {
      if (error instanceof ErrorDeCompra) return fail(error.message, 422);
      throw error;
    }
  });
}
