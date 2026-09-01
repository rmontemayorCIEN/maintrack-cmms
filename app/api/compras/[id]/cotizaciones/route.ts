import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeCompra, elegirCotizacion, emitirOrdenDeCompra, registrarCotizacion } from "@/lib/compras";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

const schema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("COTIZAR"),
    supplierId: z.string().min(1),
    folioProveedor: z.string().trim().max(60).optional().nullable(),
    vigenciaHasta: z.string().optional().nullable(),
    diasEntrega: z.coerce.number().int().min(0).max(365).optional().nullable(),
    condicionesPago: z.string().trim().max(120).optional().nullable(),
    garantia: z.string().trim().max(120).optional().nullable(),
    nota: z.string().trim().max(300).optional().nullable(),
    renglones: z.array(
      z.object({
        requestLineId: z.string().optional().nullable(),
        partId: z.string().optional().nullable(),
        descripcion: z.string().trim().min(1).max(200),
        marca: z.string().trim().max(60).optional().nullable(),
        especificacion: z.string().trim().max(200).optional().nullable(),
        cantidad: z.coerce.number().min(0),
        costoUnitario: z.coerce.number().min(0),
        disponible: z.boolean().default(true),
      }),
    ).min(1).max(80),
  }),
  z.object({ accion: z.literal("ELEGIR"), quoteId: z.string().min(1), motivo: z.string().trim().max(300).optional().nullable() }),
  z.object({ accion: z.literal("EMITIR"), fechaPrometida: z.string().optional().nullable(), nota: z.string().trim().max(300).optional().nullable() }),
]);

/** Cotizaciones, comparativo y emision de la orden de compra. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("purchase:request", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    try {
      if (input.accion === "COTIZAR") {
        const q = await registrarCotizacion({
          organizationId: orgId, purchaseRequestId: id, supplierId: input.supplierId, userId: user.id,
          folioProveedor: input.folioProveedor,
          vigenciaHasta: input.vigenciaHasta ? new Date(`${input.vigenciaHasta}T12:00:00`) : null,
          diasEntrega: input.diasEntrega, condicionesPago: input.condicionesPago,
          garantia: input.garantia, nota: input.nota, renglones: input.renglones,
        });
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "Quote", entityId: q.id, action: "CREATED",
          summary: `Cotizacion capturada por ${q.total}`,
        });
        return ok({ id: q.id, total: q.total }, 201);
      }

      if (input.accion === "ELEGIR") {
        const r = await elegirCotizacion({
          organizationId: orgId, purchaseRequestId: id, quoteId: input.quoteId, motivo: input.motivo,
        });
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "PurchaseRequest", entityId: id, action: "QUOTE_SELECTED",
          summary: `Cotizacion elegida por ${r.total}${r.eraLaMasBarata ? " (la mas barata)" : ` — ${input.motivo}`}`,
        });
        return ok(r);
      }

      const oc = await emitirOrdenDeCompra({
        organizationId: orgId, purchaseRequestId: id, userId: user.id,
        fechaPrometida: input.fechaPrometida ? new Date(`${input.fechaPrometida}T12:00:00`) : null,
        nota: input.nota,
      });
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "PurchaseOrder", entityId: oc.id, action: "ISSUED",
        summary: `Orden de compra ${oc.folio} por ${oc.total}`,
      });
      return ok({ folio: oc.folio, total: oc.total }, 201);
    } catch (error) {
      if (error instanceof ErrorDeCompra) return fail(error.message, 422);
      throw error;
    }
  });
}
