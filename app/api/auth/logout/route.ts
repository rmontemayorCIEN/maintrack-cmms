import { z } from "zod";
import { destroySession, getCurrentUser, revocarSesiones } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { ok } from "@/lib/api";

const schema = z.object({ todas: z.boolean().optional() });

/**
 * Cierra la sesion de este dispositivo o, con `todas`, la de todos.
 *
 * Borrar la cookie solo afecta a este navegador: el token firmado sigue siendo
 * valido siete dias para quien lo tenga. «Todas» mueve la fecha de corte de la
 * persona, y ahi si dejan de servir todas de golpe —el telefono que se perdio,
 * la computadora de la caseta—.
 */
export async function POST(request: Request) {
  const { todas } = schema.parse(await request.json().catch(() => ({})));
  if (todas) {
    const user = await getCurrentUser();
    if (user) {
      await revocarSesiones(user.id);
      await logAudit({
        organizationId: user.organizacionPropia.id, userId: user.id,
        entity: "User", entityId: user.id, action: "SESSIONS_REVOKED",
        summary: `${user.name} cerró sesión en todos sus dispositivos`,
      });
    }
  }
  await destroySession();
  return ok({ success: true });
}
