import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { can } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

/**
 * Solo http y https. Rechazar el resto no es formalismo: un `javascript:` en un
 * enlace que otro usuario abre desde el sistema es una via de ataque directa.
 */
const urlSegura = z
  .string()
  .trim()
  .min(4)
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, "El enlace debe empezar con http:// o https://");

const schema = z.object({
  assetId: z.string().optional().nullable(),
  partId: z.string().optional().nullable(),
  planId: z.string().optional().nullable(),
  title: z.string().trim().min(2).max(150),
  url: urlSegura,
  note: z.string().trim().max(300).optional().nullable(),
});

function destinoDe(d: { assetId?: string | null; partId?: string | null; planId?: string | null }) {
  if (d.assetId) return { clave: "assetId" as const, id: d.assetId, permiso: "asset:write" as const };
  if (d.partId) return { clave: "partId" as const, id: d.partId, permiso: "inventory:write" as const };
  if (d.planId) return { clave: "planId" as const, id: d.planId, permiso: "plan:write" as const };
  return null;
}

export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const input = schema.parse(await request.json());
    const destino = destinoDe(input);
    if (!destino) return fail("Falta indicar a que registro pertenece el enlace", 422);
    if (!can(user.role, destino.permiso)) return fail("Sin permisos suficientes", 403);

    // El registro debe existir y ser de esta organizacion.
    const tablas = { assetId: prisma.asset, partId: prisma.part, planId: prisma.maintenancePlan };
    const existe = await (tablas[destino.clave] as { findFirst: Function }).findFirst({
      where: { id: destino.id, organizationId: orgId },
      select: { id: true },
    });
    if (!existe) return fail("El registro no existe", 404);

    const enlace = await prisma.referenceLink.create({
      data: {
        organizationId: orgId,
        createdById: user.id,
        title: input.title,
        url: input.url,
        note: input.note ?? null,
        [destino.clave]: destino.id,
      },
      select: { id: true, title: true, url: true, note: true, createdAt: true },
    });

    await logAudit({
      organizationId: orgId, userId: user.id,
      entity: "ReferenceLink", entityId: enlace.id,
      action: "CREATED", summary: `Enlace "${input.title}"`,
    });

    return ok({ link: enlace }, 201);
  });
}
