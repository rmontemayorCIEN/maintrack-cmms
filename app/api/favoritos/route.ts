import { z } from "zod";
import { fail, ok, withAuth } from "@/lib/api";
import { ErrorDeFavoritos, MAXIMO_FAVORITOS, guardarFavoritos } from "@/lib/favoritos";

const esquema = z.object({
  rutas: z.array(z.string().min(1).max(200)).max(MAXIMO_FAVORITOS + 5),
});

/**
 * Los accesos rápidos de quien pide, no de quien se le diga.
 *
 * El `userId` sale de la sesión y nunca del cuerpo: si viajara en la petición,
 * cualquiera podría reacomodarle el menú a otro. Por eso tampoco hay un
 * permiso especial —`workorder:execute` lo tiene todo el que trabaja en el
 * sistema— : cada quien decide el suyo.
 */
export async function PUT(request: Request) {
  return withAuth("workorder:execute", async ({ user, orgId }) => {
    const { rutas } = esquema.parse(await request.json());
    try {
      const guardadas = await guardarFavoritos({
        organizationId: orgId,
        userId: user.id,
        rutas,
        rol: user.role,
        opciones: { esSuperAdmin: user.isSuperAdmin, esDemo: user.organization.esDemo },
      });
      return ok({ rutas: guardadas });
    } catch (e) {
      if (e instanceof ErrorDeFavoritos) return fail(e.message, 422);
      throw e;
    }
  });
}
