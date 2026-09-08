import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const schema = z.object({ avisosPush: z.boolean() });

/**
 * Enciende o apaga los avisos al celular para toda la organizacion.
 *
 * Apagarlo NO borra los aparatos registrados. Quien ya hizo el tramite en su
 * telefono no tiene por que repetirlo si manana se vuelve a encender: se
 * dejan de usar y ya. Borrarlos seria destruir trabajo de otras personas por
 * una decision administrativa.
 */
export async function PATCH(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    await prisma.organization.update({
      where: { id: orgId },
      data: { avisosPush: input.avisosPush },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Organization",
      entityId: orgId,
      action: "UPDATED",
      summary: `Avisos al celular: ${input.avisosPush ? "encendidos" : "apagados"}`,
    });

    return ok({ avisosPush: input.avisosPush });
  });
}
