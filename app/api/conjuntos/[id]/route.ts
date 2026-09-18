import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { clasificacionLimpia, loQueImpideBorrar, referenciasInvalidas } from "@/lib/conjuntos";

const schema = z.object({
  name: z.string().min(2).max(120).optional(),
  descripcion: z.string().max(2000).nullable().optional(),
  responsableId: z.string().nullable().optional(),
  siteId: z.string().nullable().optional(),
  clasificacion: z.string().max(80).nullable().optional(),
  active: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("asset:write", async ({ user, orgId }) => {
    const existe = await prisma.conjunto.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!existe) return fail("No encontrado", 404);

    const input = schema.parse(await request.json());
    const invalida = await referenciasInvalidas(orgId, input);
    if (invalida) return fail(invalida, 422);
    await prisma.conjunto.update({
      where: { id },
      data: {
        ...input,
        ...(input.siteId !== undefined ? { siteId: input.siteId || null } : {}),
        ...(input.clasificacion !== undefined ? { clasificacion: clasificacionLimpia(input.clasificacion) } : {}),
      },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Conjunto",
      entityId: id,
      action: "UPDATED",
      summary: `${input.name ?? existe.name}${input.active === false ? " · desactivado" : ""}`,
    });
    return ok({ id });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  return withAuth("asset:write", async ({ user, orgId }) => {
    const existe = await prisma.conjunto.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!existe) return fail("No encontrado", 404);

    // Nada se borra si tiene algo vivo adentro, y se dice QUE lo impide: un
    // "no se puede" sin motivo obliga a adivinar.
    const impedimento = await loQueImpideBorrar(orgId, id);
    if (impedimento) return fail(impedimento, 409);

    await prisma.conjunto.delete({ where: { id } });
    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "Conjunto",
      entityId: id,
      action: "DELETED",
      summary: existe.name,
    });
    return ok({ id });
  });
}
