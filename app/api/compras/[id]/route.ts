import { z } from "zod";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeAlmacen, ErrorDeCompra, autorizar, enCompra, recibir } from "@/lib/compras";
import { logAudit } from "@/lib/audit";
import { ESTADOS_COMPRA, type EstadoCompra } from "@/lib/estados-compra";

type Params = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("AUTORIZAR") }),
  z.object({ accion: z.literal("RECHAZAR"), motivo: z.string().trim().min(3).max(300) }),
  z.object({ accion: z.literal("COLOCAR"), ordenCompra: z.string().trim().min(1).max(60) }),
  z.object({
    accion: z.literal("RECIBIR"),
    /** Clave del envio: el mismo recibo repetido no entra dos veces. */
    clave: z.string().trim().max(64).optional().nullable(),
    remision: z.string().trim().max(60).optional().nullable(),
    supplierId: z.string().optional().nullable(),
    nota: z.string().trim().max(300).optional().nullable(),
    renglones: z.array(
      z.object({
        requestLineId: z.string().optional().nullable(),
        partId: z.string().min(1),
        cantidad: z.coerce.number().min(0),
        costoUnitario: z.coerce.number().min(0).default(0),
        conforme: z.boolean().default(true),
        observacion: z.string().trim().max(200).optional().nullable(),
      }),
    ).min(1).max(80),
  }),
  z.object({ accion: z.literal("CERRAR") }),
]);

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth(null, async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    // Cada accion pide lo suyo: autorizar no es lo mismo que recibir, y quien
    // pide no puede firmarse a si mismo.
    const permiso =
      input.accion === "AUTORIZAR" || input.accion === "RECHAZAR" ? "purchase:authorize"
        : input.accion === "RECIBIR" ? "purchase:receive"
        : "purchase:request";
    if (!can(user.role, permiso)) return fail("Sin permisos suficientes", 403);

    const compra = await prisma.purchaseRequest.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, folio: true, warehouseId: true, ordenCompra: true, solicitanteId: true },
    });
    if (!compra) return fail("Requisición de compra no encontrada", 404);

    try {
      if (input.accion === "AUTORIZAR" || input.accion === "RECHAZAR") {
        if (compra.solicitanteId === user.id) {
          return fail("No puede autorizar su propia requisición. La firma otra persona.", 403);
        }
        const r = await autorizar({
          organizationId: orgId, requestId: id, userId: user.id,
          aprueba: input.accion === "AUTORIZAR",
          motivo: input.accion === "RECHAZAR" ? input.motivo : null,
        });
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "PurchaseRequest", entityId: id, action: input.accion,
          summary: `Compra ${r.folio} ${input.accion === "AUTORIZAR" ? "autorizada" : "rechazada"}`,
        });
        return ok({ estado: r.estado });
      }

      if (input.accion === "COLOCAR") {
        const r = await enCompra({ organizationId: orgId, requestId: id, ordenCompra: input.ordenCompra });
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "PurchaseRequest", entityId: id, action: "ORDERED",
          summary: `Compra ${r.folio} colocada con orden ${input.ordenCompra}`,
        });
        return ok({ estado: r.estado });
      }

      if (input.accion === "RECIBIR") {
        const rec = await recibir({
          organizationId: orgId, userId: user.id,
          purchaseRequestId: id, warehouseId: compra.warehouseId,
          supplierId: input.supplierId, remision: input.remision,
          ordenCompra: compra.ordenCompra, nota: input.nota, clave: input.clave,
          renglones: input.renglones,
        });
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "GoodsReceipt", entityId: rec.id, action: "RECEIVED",
          summary: `Recepcion ${rec.folio} contra ${compra.folio}`,
        });
        return ok({ recepcion: rec.folio });
      }

      // Cerrar es dar por terminada la compra: no se cierra lo que ya estaba
      // cerrado, rechazado o cancelado.
      const actual = await prisma.purchaseRequest.findFirstOrThrow({ where: { id }, select: { estado: true } });
      if (["CERRADA", "CANCELADA", "RECHAZADA"].includes(actual.estado)) {
        return fail(`La requisición ya está ${ESTADOS_COMPRA[actual.estado as EstadoCompra].toLowerCase()}`, 409);
      }
      const cerrada = await prisma.purchaseRequest.update({
        where: { id }, data: { estado: "CERRADA" }, select: { estado: true },
      });
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "PurchaseRequest", entityId: id, action: "CLOSED",
        summary: `Compra ${compra.folio} cerrada`,
      });
      return ok(cerrada);
    } catch (error) {
      if (error instanceof ErrorDeCompra || error instanceof ErrorDeAlmacen) return fail(error.message, 422);
      throw error;
    }
  });
}
