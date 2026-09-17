import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { LecturaRechazada, anularLectura, corregirLectura } from "@/lib/medidores";

const corregir = z.object({
  value: z.coerce.number().min(0),
  readingAt: z.string().optional(),
  /** Solo reinicios y sustituciones: cambiar uno por el otro. */
  tipo: z.enum(["LECTURA", "REINICIO", "SUSTITUCION"]).optional(),
  motivo: z.string().trim().min(3, "Indique el motivo de la corrección"),
  confirmar: z.boolean().optional(),
});

const anular = z.object({
  motivo: z.string().trim().min(3, "Indique el motivo de la anulación"),
});

function traducir(error: unknown) {
  if (error instanceof LecturaRechazada) return fail(error.message, 422, { validacion: error.validacion });
  if (error instanceof Error && /no encontrada|anulada|no se convierte/.test(error.message)) {
    return fail(error.message, error.message.includes("no encontrada") ? 404 : 422);
  }
  throw error;
}

/** Corrige una lectura conservando el valor original y el rastro. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAuth("asset:write", async ({ user, orgId }) => {
    const { id } = await params;
    const input = corregir.parse(await request.json());
    try {
      const r = await corregirLectura({
        organizationId: orgId,
        readingId: id,
        userId: user.id,
        value: input.value,
        readingAt: input.readingAt ? new Date(input.readingAt) : undefined,
        tipo: input.tipo,
        motivo: input.motivo,
        confirmar: input.confirmar,
      });
      if (!r.ok) return fail(r.validacion.mensaje, 409, { requiereConfirmacion: true, validacion: r.validacion });
      return ok(r);
    } catch (error) {
      return traducir(error);
    }
  });
}

/** Anula una lectura. No la borra: queda visible como anulada, con motivo. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAuth("asset:write", async ({ user, orgId }) => {
    const { id } = await params;
    const input = anular.parse(await request.json());
    try {
      return ok({ recalculo: await anularLectura({ organizationId: orgId, readingId: id, userId: user.id, motivo: input.motivo }) });
    } catch (error) {
      return traducir(error);
    }
  });
}
