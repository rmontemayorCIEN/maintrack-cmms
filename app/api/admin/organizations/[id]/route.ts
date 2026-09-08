import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/superadmin";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  plan: z.enum(["PROFESSIONAL", "ENTERPRISE"]).optional(),
  status: z.enum(["ACTIVE", "TRIAL", "SUSPENDED", "CANCELLED"]).optional(),
  name: z.string().trim().min(2).optional(),
  tipoInstalacion: z.string().trim().max(20).nullable().optional(),
  /// Complemento "IA Avanzada": se activa cuando el cliente lo contrata.
  iaComplemento: z.boolean().optional(),
  /// Operaciones de IA sueltas para el periodo en curso.
  iaExtra: z.coerce.number().int().min(0).max(10_000).optional(),
});

/** Cambio de plan o suspension de una empresa cliente. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!org) return fail("Empresa no encontrada", 404);

  if (id === user.organizacionPropia.id) {
    return fail("No puede suspender ni degradar su propia organización desde aquí", 403);
  }

  const input = schema.parse(await request.json());
  const actualizada = await prisma.organization.update({
    where: { id },
    data: input,
    select: { id: true, name: true, plan: true, status: true },
  });

  await logAudit({
    organizationId: user.organizacionPropia.id,
    userId: user.id,
    entity: "Organization",
    entityId: id,
    action: "CLIENT_UPDATED",
    summary: `${org.name}: ${JSON.stringify(input)}`,
  });

  return ok({ organization: actualizada });
}
