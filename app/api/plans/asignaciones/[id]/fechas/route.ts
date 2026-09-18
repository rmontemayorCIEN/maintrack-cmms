import { z } from "zod";
import { diaLocal } from "@/lib/utils";
import { fail, ok, withAuth, withVista } from "@/lib/api";
import { ErrorDeFechas, corregirFechas, fechasDeAsignacion } from "@/lib/calendario-actividad";

type Params = { params: Promise<{ id: string }> };

/** Las actividades del plan en ESTE equipo, cada una con su fecha. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  return withVista("/plans", async ({ orgId }) => {
    const r = await fechasDeAsignacion(orgId, id);
    if (!r) return fail("Asignación no encontrada", 404);
    return ok(r);
  });
}

const esquema = z.object({
  cambios: z
    .array(
      z.object({
        planTaskId: z.string().min(1),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        /** Verdadero: "la ultima vez se hizo ese dia". Falso: "toca ese dia". */
        esUltima: z.boolean(),
      }),
    )
    .min(1),
});

/**
 * Corrige la fecha de una o varias actividades de un equipo.
 *
 * Todo o nada, y con bitacora: la logica y las validaciones viven en
 * `corregirFechas()`, la misma que llama la prueba.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("plan:write", async ({ user, orgId }) => {
    const input = esquema.parse(await request.json());
    try {
      const r = await corregirFechas({
        organizationId: orgId,
        userId: user.id,
        planAssetId: id,
        cambios: input.cambios.map((c) => ({
          planTaskId: c.planTaskId,
          // A medianoche local (diaLocal): "2026-09-17" no debe guardarse como el 16.
          fecha: diaLocal(c.fecha)!,
          esUltima: c.esUltima,
        })),
      });
      return ok(r);
    } catch (e) {
      if (e instanceof ErrorDeFechas) return fail(e.message, e.codigo);
      throw e;
    }
  });
}
