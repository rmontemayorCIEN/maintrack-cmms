import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { LecturaRechazada, registrarLectura } from "@/lib/medidores";

const schema = z.object({
  meterId: z.string(),
  value: z.coerce.number().min(0),
  readingAt: z.string().optional(),
  note: z.string().optional(),
  tipo: z.enum(["LECTURA", "REINICIO", "SUSTITUCION"]).default("LECTURA"),
  confirmar: z.boolean().optional(),
  justificacion: z.string().optional(),
});

/**
 * Registro de lectura de medidor. Toda la regla vive en `lib/medidores.ts`:
 * esta ruta solo traduce. Una lectura atipica responde 409 con el detalle y se
 * reenvia con `confirmar` y `justificacion`.
 */
export async function POST(request: Request) {
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    try {
      const r = await registrarLectura({
        organizationId: orgId,
        meterId: input.meterId,
        userId: user.id,
        value: input.value,
        readingAt: input.readingAt ? new Date(input.readingAt) : undefined,
        tipo: input.tipo,
        note: input.note,
        confirmar: input.confirmar,
        justificacion: input.justificacion,
      });
      if (!r.ok) return fail(r.validacion.mensaje, 409, { requiereConfirmacion: true, validacion: r.validacion });
      return ok(r, 201);
    } catch (error) {
      if (error instanceof LecturaRechazada) return fail(error.message, 422, { validacion: error.validacion });
      if (error instanceof Error && error.message === "Medidor no encontrado") return fail(error.message, 404);
      throw error;
    }
  });
}
