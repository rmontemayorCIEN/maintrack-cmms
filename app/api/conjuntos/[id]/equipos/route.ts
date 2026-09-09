import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const schema = z.object({ assetIds: z.array(z.string()).max(500) });

type Params = { params: Promise<{ id: string }> };

/**
 * Fija QUE equipos pertenecen al conjunto. Llega la lista completa.
 *
 * Uno por uno dejaria estados a medias si se corta la red a la mitad, con
 * algunos equipos dentro y otros no, y sin forma de saber cuales. Ademas, la
 * pantalla siempre conoce la lista entera: mandarla completa es lo natural.
 *
 * A los que ya estaban NO se les toca su acomodo en el lienzo: borrar y volver
 * a crear la membresia perderia la posicion que alguien ya habia cuidado.
 */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("asset:write", async ({ user, orgId }) => {
    const conjunto = await prisma.conjunto.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!conjunto) return fail("No encontrado", 404);

    const { assetIds } = schema.parse(await request.json());
    const propios = await prisma.asset.findMany({
      where: { organizationId: orgId, id: { in: assetIds } },
      select: { id: true },
    });
    const quedan = new Set(propios.map((a) => a.id));

    const actuales = await prisma.conjuntoAsset.findMany({
      where: { conjuntoId: id },
      select: { assetId: true },
    });
    const yaEstaban = new Set(actuales.map((m) => m.assetId));

    const entran = [...quedan].filter((a) => !yaEstaban.has(a));
    const salen = [...yaEstaban].filter((a) => !quedan.has(a));

    await prisma.$transaction([
      ...(salen.length
        ? [prisma.conjuntoAsset.deleteMany({ where: { conjuntoId: id, assetId: { in: salen } } })]
        : []),
      ...entran.map((assetId) =>
        prisma.conjuntoAsset.create({ data: { organizationId: orgId, conjuntoId: id, assetId } }),
      ),
    ]);

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Conjunto",
      entityId: id,
      action: "UPDATED",
      summary: `${conjunto.name}: ${quedan.size} equipos (+${entran.length} −${salen.length})`,
    });

    return ok({ equipos: quedan.size, entran: entran.length, salen: salen.length });
  });
}
