import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { aplicarProcedimiento, generarProcedimiento } from "@/lib/ia/procedimiento";
import { logAudit } from "@/lib/audit";

export const maxDuration = 180;

/**
 * Los textos se RECORTAN, no se rechazan.
 *
 * Lo que llega aqui lo escribio el modelo hace un momento y el usuario ya lo
 * reviso en pantalla. Tirar el procedimiento completo porque una advertencia
 * salio veinte caracteres larga significa perder trabajo que ya se pago y
 * obligar a generarlo de nuevo. El limite existe para acotar lo que entra a la
 * base, no para castigar al usuario.
 */
const recortado = (max: number) =>
  z.string().trim().transform((t) => t.slice(0, max));

const paso = z.object({
  titulo: recortado(200).pipe(z.string().min(3)),
  detalle: recortado(600).nullable(),
  tipo: z.enum(["CHECK", "MEASURE", "REPLACE", "TEXT"]),
  unidad: recortado(20).nullable(),
  minimo: z.number().nullable(),
  maximo: z.number().nullable(),
});

const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("GENERAR"), workOrderId: z.string().min(1) }),
  z.object({
    accion: z.literal("APLICAR"),
    workOrderId: z.string().min(1),
    procedimiento: z.object({
      pasos: z.array(paso).min(1),
      seguridad: z.array(recortado(400)),
      herramientas: z.array(recortado(120)),
      refaccionesProbables: z.array(z.object({ codigo: recortado(40), porQue: recortado(300) })),
      advertencia: recortado(800).nullable(),
    }),
  }),
]);

export async function POST(request: Request) {
  return withAuth("workorder:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    if (input.accion === "APLICAR") {
      try {
        const r = await aplicarProcedimiento({
          organizationId: orgId, workOrderId: input.workOrderId, procedimiento: input.procedimiento,
        });
        await logAudit({
          organizationId: orgId, userId: user.id,
          entity: "WorkOrder", entityId: input.workOrderId, action: "PROCEDURE_APPLIED",
          summary: `Procedimiento aplicado: ${r.pasos} actividades`,
        });
        return ok(r);
      } catch (error) {
        return fail(error instanceof Error ? error.message : "No fue posible aplicar", 422);
      }
    }

    if (!iaConfigurada()) return fail("La generación de procedimientos no esta configurada en este servidor.", 503);
    try {
      const r = await generarProcedimiento(
        {
          id: orgId,
          plan: user.organization.plan,
          iaComplemento: user.organization.iaComplemento,
          iaExtra: user.organization.iaExtra,
        },
        { workOrderId: input.workOrderId, userId: user.id, operador: user.isSuperAdmin },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ procedimiento: r.procedimiento });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible generar", 502);
    }
  });
}
