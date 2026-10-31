import { getCurrentUser } from "./auth";
import { fail } from "./api";
import { tieneSegundoFactor } from "./segundo-factor";

export const SIN_SEGUNDO_FACTOR = "Active su segundo factor en Configuración → Seguridad y sesiones: el operador entra a los datos de todas las empresas.";

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
  // El operador entra a todas las empresas: sin segundo factor activo no opera
  // (ISO 27001, 8.5). Se le dice donde activarlo en lugar de un «no» mudo.
  if (!tieneSegundoFactor(user)) {
    return { error: fail(SIN_SEGUNDO_FACTOR, 403) as never, user: null };
  }
  return { error: null, user };
}
