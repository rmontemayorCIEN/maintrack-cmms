import { getCurrentUser } from "./auth";
import { fail } from "./api";

/**
 * Verifica que quien llama sea operador de la plataforma.
 *
 * Se comprueba contra la base en cada peticion, no contra la sesion: si se le
 * retira el privilegio, deja de tener efecto de inmediato aunque su token siga
 * vigente. Devuelve el usuario, o una respuesta de error lista para retornar.
 */
export async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: fail("No autenticado", 401) as never, user: null };
  if (!user.isSuperAdmin) {
    return { error: fail("Solo el operador de la plataforma puede hacer esto", 403) as never, user: null };
  }
  return { error: null, user };
}
