import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { REJILLA } from "@/lib/croquis";

const schema = z.object({
  areas: z
    .array(
      z.object({
        locationId: z.string().min(1),
        x: z.number().int().min(0).max(REJILLA.columnas - 1),
        y: z.number().int().min(0).max(REJILLA.filas - 1),
        ancho: z.number().int().min(1).max(REJILLA.columnas),
        alto: z.number().int().min(1).max(REJILLA.filas),
      }),
    )
    .max(200),
});

/**
 * Guarda el croquis de la planta.
 *
 * Llega el acomodo COMPLETO y no un area a la vez. Es un dibujo: guardar caja
 * por caja dejaria estados a medias si se corta la red a la mitad, con unas
 * areas movidas y otras no, y el usuario no tendria forma de saber cuales.
 */
export async function PATCH(request: Request) {
  return withAuth("settings:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    // Que ninguna caja se salga de la rejilla por la orilla derecha o de abajo.
    const fuera = input.areas.find(
      (a) => a.x + a.ancho > REJILLA.columnas || a.y + a.alto > REJILLA.filas,
    );
    if (fuera) return fail("Una de las áreas quedó fuera del croquis.", 422);

    // Solo ubicaciones de esta organizacion: sin este filtro, conociendo un
    // identificador se podria mover el croquis de otra empresa.
    const propias = await prisma.location.findMany({
      where: { organizationId: orgId, id: { in: input.areas.map((a) => a.locationId) } },
      select: { id: true },
    });
    const validas = new Set(propias.map((l) => l.id));

    await prisma.$transaction(
      input.areas
        .filter((a) => validas.has(a.locationId))
        .map((a) =>
          prisma.location.update({
            where: { id: a.locationId },
            data: { planoX: a.x, planoY: a.y, planoAncho: a.ancho, planoAlto: a.alto },
          }),
        ),
    );

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Organization",
      entityId: orgId,
      action: "UPDATED",
      summary: `Croquis de la planta acomodado (${validas.size} áreas)`,
    });

    return ok({ guardadas: validas.size });
  });
}
