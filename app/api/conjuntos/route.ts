import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { claveSugerida, clasificacionLimpia, referenciasInvalidas } from "@/lib/conjuntos";

const schema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(20).optional(),
  descripcion: z.string().max(2000).nullable().optional(),
  responsableId: z.string().nullable().optional(),
  siteId: z.string().nullable().optional(),
  clasificacion: z.string().max(80).nullable().optional(),
  assetIds: z.array(z.string()).max(500).optional(),
});

export async function POST(request: Request) {
  return withAuth("asset:write", async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const code = (input.code?.trim() || claveSugerida(input.name)) || "CONJUNTO";
    const invalida = await referenciasInvalidas(orgId, input);
    if (invalida) return fail(invalida, 422);

    const repetida = await prisma.conjunto.findFirst({
      where: { organizationId: orgId, code },
      select: { name: true },
    });
    if (repetida) return fail(`La clave ${code} ya la usa "${repetida.name}"`, 422);

    // Solo equipos de esta organizacion: sin este filtro, conociendo un
    // identificador se podria meter el equipo de otra empresa a un conjunto.
    const propios = input.assetIds?.length
      ? await prisma.asset.findMany({
          where: { organizationId: orgId, id: { in: input.assetIds } },
          select: { id: true },
        })
      : [];

    const conjunto = await prisma.conjunto.create({
      data: {
        organizationId: orgId,
        code,
        name: input.name.trim(),
        descripcion: input.descripcion?.trim() || null,
        responsableId: input.responsableId || null,
        siteId: input.siteId || null,
        clasificacion: clasificacionLimpia(input.clasificacion),
        origen: "MANUAL",
        equipos: {
          create: propios.map((a) => ({ organizationId: orgId, assetId: a.id })),
        },
      },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Conjunto",
      entityId: conjunto.id,
      action: "CREATED",
      summary: `${conjunto.name} (${conjunto.code}) con ${propios.length} equipos`,
    });

    return ok({ id: conjunto.id });
  });
}
