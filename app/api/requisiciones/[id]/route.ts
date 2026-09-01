import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeAlmacen } from "@/lib/almacen";
import { ErrorDeRequisicion, cancelar, cerrar, devolver, surtir } from "@/lib/requisiciones";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

const renglones = z.array(
  z.object({ lineId: z.string().min(1), cantidad: z.coerce.number().min(0) }),
).min(1).max(80);

const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("SURTIR"), entregadoA: z.string().trim().min(2).max(120), renglones }),
  z.object({ accion: z.literal("DEVOLVER"), devuelvePor: z.string().trim().max(120).default(""), renglones }),
  z.object({ accion: z.literal("CERRAR") }),
  z.object({ accion: z.literal("CANCELAR") }),
]);

/**
 * Surtir, devolver, cerrar o cancelar.
 *
 * Surtir y devolver mueven existencia, asi que exigen inventory:write: quien
 * pide no es quien entrega. La logica vive en lib/requisiciones.ts.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("inventory:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    try {
      if (input.accion === "SURTIR") {
        const req = await surtir({
          organizationId: orgId, requestId: id, userId: user.id,
          entregadoA: input.entregadoA, renglones: input.renglones,
        });
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "MaterialRequest", entityId: id, action: "DISPATCHED",
          summary: `Vale ${req.folio} entregado a ${input.entregadoA}`,
        });
        return ok({ estado: req.estado });
      }

      if (input.accion === "DEVOLVER") {
        const req = await devolver({
          organizationId: orgId, requestId: id, userId: user.id,
          devuelvePor: input.devuelvePor, renglones: input.renglones,
        });
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "MaterialRequest", entityId: id, action: "RETURNED",
          summary: `Devolucion contra ${req.folio}`,
        });
        return ok({ estado: req.estado });
      }

      if (input.accion === "CERRAR") {
        const req = await cerrar(orgId, id);
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "MaterialRequest", entityId: id, action: "CLOSED",
          summary: `Requisicion ${req.folio} cerrada`,
        });
        return ok({ estado: req.estado });
      }

      const req = await cancelar(orgId, id);
      await logAudit({
        organizationId: orgId, userId: user.id,
        entity: "MaterialRequest", entityId: id, action: "CANCELLED",
        summary: `Requisicion ${req.folio} cancelada`,
      });
      return ok({ estado: req.estado });
    } catch (error) {
      if (error instanceof ErrorDeRequisicion || error instanceof ErrorDeAlmacen) {
        return fail(error.message, 422);
      }
      throw error;
    }
  });
}
