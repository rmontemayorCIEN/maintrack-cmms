import { estadoSuscripcion } from "../planes";
import type { getCurrentUser } from "../auth";
import type { Quien } from "./consultor";

/** Quien pregunta, armado de la sesion. Lo usan la pantalla y las rutas: un solo lugar. */
export function quienDe(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>): Quien {
  return {
    userId: user.id,
    nombre: user.name,
    orgId: user.organizationId,
    rol: user.role,
    esOperador: Boolean(user.isSuperAdmin),
    // El operador entra a cuentas vencidas justamente para revisarlas (como en withAuth).
    soloLectura: !user.isSuperAdmin && Boolean(estadoSuscripcion(user.organization).soloLectura),
  };
}
