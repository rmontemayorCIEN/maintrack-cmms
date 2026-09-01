import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { almacenPorOmision } from "@/lib/almacen";
import { siguienteFolio } from "@/lib/numbering";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  warehouseId: z.string().optional().nullable(),
  workOrderId: z.string().optional().nullable(),
  assetId: z.string().optional().nullable(),
  motivo: z.enum(["PREVENTIVO", "CORRECTIVO", "MINIMO", "PROYECTO"]).default("CORRECTIVO"),
  urgencia: z.enum(["NORMAL", "ALTA", "PARO"]).default("NORMAL"),
  nota: z.string().trim().max(500).optional().nullable(),
  renglones: z.array(
    z.object({
      partId: z.string().optional().nullable(),
      descripcion: z.string().trim().min(2).max(200),
      cantidadSolicitada: z.coerce.number().positive(),
      nota: z.string().trim().max(200).optional().nullable(),
    }),
  ).min(1).max(80),
});

/** Alta de requisicion de material. Pedir no mueve existencia. */
export async function POST(request: Request) {
  return withAuth("requisition:create", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const warehouseId = input.warehouseId || (await almacenPorOmision(orgId))?.id;
    if (!warehouseId) return fail("La cuenta no tiene ningun almacen activo", 409);

    const almacen = await prisma.warehouse.findFirst({
      where: { id: warehouseId, organizationId: orgId },
      select: { id: true },
    });
    if (!almacen) return fail("Almacen no encontrado", 404);

    // Una requisicion sin OT ni activo produce un costo que despues nadie
    // puede atribuir a nada. Se exige al menos uno de los dos.
    if (!input.workOrderId && !input.assetId) {
      return fail("Indique la orden de trabajo o el activo al que se destina el material", 422);
    }

    // Con orden de trabajo, el activo SALE de la orden: es el mismo dato y
    // guardar dos copias solo abre la puerta a que se contradigan. Ademas se
    // valida que la orden sea de esta organizacion.
    let assetId = input.assetId || null;
    if (input.workOrderId) {
      const orden = await prisma.workOrder.findFirst({
        where: { id: input.workOrderId, organizationId: orgId },
        select: { assetId: true },
      });
      if (!orden) return fail("Orden de trabajo no encontrada", 404);
      assetId = orden.assetId;
    } else if (assetId) {
      const activo = await prisma.asset.findFirst({
        where: { id: assetId, organizationId: orgId },
        select: { id: true },
      });
      if (!activo) return fail("Activo no encontrado", 404);
    }

    const folio = await siguienteFolio(orgId, "requisicion");
    const req = await prisma.materialRequest.create({
      data: {
        organizationId: orgId,
        folio,
        warehouseId: almacen.id,
        workOrderId: input.workOrderId || null,
        assetId,
        solicitanteId: user.id,
        motivo: input.motivo,
        urgencia: input.urgencia,
        nota: input.nota || null,
        renglones: {
          create: input.renglones.map((r) => ({
            partId: r.partId || null,
            descripcion: r.descripcion,
            cantidadSolicitada: r.cantidadSolicitada,
            nota: r.nota || null,
          })),
        },
      },
      select: { id: true, folio: true },
    });

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "MaterialRequest", entityId: req.id, action: "CREATED",
      summary: `Requisicion ${req.folio}: ${input.renglones.length} renglones`,
    });

    return ok({ id: req.id, folio: req.folio }, 201);
  });
}
