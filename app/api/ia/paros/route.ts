import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { IaNoConfigurada, iaConfigurada } from "@/lib/ia/cliente";
import { explicarParos } from "@/lib/ia/paros";
import { PERIODOS } from "@/lib/costo-de-parar";

export const maxDuration = 180;

const schema = z.object({
  /** Nulo es valido: son los equipos sin ubicacion asignada. */
  locationId: z.string().min(1).nullable(),
  periodo: z.enum(Object.keys(PERIODOS) as [string, ...string[]]),
});

/**
 * Por que se detuvo un area.
 *
 * Va con `withAuth(null)` —el permiso de lectura— porque no escribe nada: lee
 * ordenes y devuelve una explicacion. Quien puede ver el mapa puede preguntar
 * por que esta rojo.
 *
 * El resultado NO se guarda. Es una lectura de un periodo que el usuario
 * eligio, y guardarla obligaria a invalidarla cada vez que cambia el periodo o
 * se cierra una orden. Una explicacion vieja pegada a un mapa nuevo es peor
 * que no tener explicacion.
 */
export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    if (!iaConfigurada()) {
      return fail("El análisis con inteligencia artificial no está configurado en este servidor.", 503);
    }
    const input = schema.parse(await request.json());

    try {
      const r = await explicarParos(
        {
          id: orgId,
          plan: user.organization.plan,
          iaComplemento: user.organization.iaComplemento,
          iaExtra: user.organization.iaExtra,
        },
        {
          locationId: input.locationId,
          periodo: input.periodo as Parameters<typeof explicarParos>[1]["periodo"],
          userId: user.id,
          operador: user.isSuperAdmin,
        },
      );
      if (!r.ok) return fail(r.motivo, 402);
      return ok({ analisis: r.analisis, area: r.area });
    } catch (error) {
      if (error instanceof IaNoConfigurada) return fail(error.message, 503);
      return fail(error instanceof Error ? error.message : "No fue posible analizar", 502);
    }
  });
}
