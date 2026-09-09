import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { REJILLA } from "@/lib/croquis";

const schema = z.object({
  equipos: z
    .array(
      z.object({
        id: z.string().min(1),
        x: z.number().int().min(0).max(REJILLA.columnas - 1),
        y: z.number().int().min(0).max(REJILLA.filas - 1),
        ancho: z.number().int().min(1).max(REJILLA.columnas),
        alto: z.number().int().min(1).max(REJILLA.filas),
      }),
    )
    .max(200),
});

type Params = { params: Promise<{ id: string }> };

/**
 * Guarda el acomodo de los equipos de un conjunto.
 *
 * Llega el acomodo COMPLETO y no un equipo a la vez. Es un dibujo: guardar
 * caja por caja dejaria estados a medias si se corta la red a la mitad, con
 * unos equipos movidos y otros no, y el usuario no tendria forma de saber
 * cuales.
 *
 * Las coordenadas se escriben en la MEMBRESIA, no en el equipo: el mismo
 * equipo esta en varios conjuntos con una posicion distinta en cada lienzo.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("asset:write", async ({ user, orgId }) => {
    const conjunto = await prisma.conjunto.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!conjunto) return fail("No encontrado", 404);

    const input = schema.parse(await request.json());

    // Que ninguna caja se salga de la rejilla por la orilla derecha o de abajo.
    const fuera = input.equipos.find(
      (e) => e.x + e.ancho > REJILLA.columnas || e.y + e.alto > REJILLA.filas,
    );
    if (fuera) return fail("Uno de los equipos quedó fuera del lienzo.", 422);

    // Solo membresias de ESTE conjunto y de esta organizacion: sin el filtro,
    // conociendo un identificador se podria mover el lienzo de otra empresa.
    const propias = await prisma.conjuntoAsset.findMany({
      where: {
        organizationId: orgId,
        conjuntoId: id,
        assetId: { in: input.equipos.map((e) => e.id) },
      },
      select: { id: true, assetId: true },
    });
    const porAsset = new Map(propias.map((m) => [m.assetId, m.id]));

    await prisma.$transaction(
      input.equipos
        .filter((e) => porAsset.has(e.id))
        .map((e) =>
          prisma.conjuntoAsset.update({
            where: { id: porAsset.get(e.id) as string },
            data: { planoX: e.x, planoY: e.y, planoAncho: e.ancho, planoAlto: e.alto },
          }),
        ),
    );

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Conjunto",
      entityId: id,
      action: "UPDATED",
      summary: `${conjunto.name}: lienzo acomodado (${porAsset.size} equipos)`,
    });

    return ok({ guardados: porAsset.size });
  });
}
