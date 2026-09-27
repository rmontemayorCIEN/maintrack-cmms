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
  /// «Registros propios»: se activa cuando el cliente lo contrata. Es lo
  /// unico que hace alcanzable el modulo, asi que vive donde se cobra.
  registrosPropios: z.boolean().optional(),
  /// «Cumplimiento normativo»: el otro que se cobra aparte.
  cumplimientoNormas: z.boolean().optional(),
});

/** Cambio de plan o suspension de una empresa cliente. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error, user } = await requireSuperAdmin();
  if (error) return error;

  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, esDemo: true, plan: true } });
  if (!org) return fail("Empresa no encontrada", 404);

  if (id === user.organizacionPropia.id) {
    return fail("No puede suspender ni degradar su propia organización desde aquí", 403);
  }

  const input = schema.parse(await request.json());
  // La demo no se suspende ni se cancela por cobranza: no tiene cargos (Bloque 7).
  if (org.esDemo && (input.status === "SUSPENDED" || input.status === "CANCELLED")) {
    return fail("La empresa demostrativa no se suspende ni se cancela; si ya no se usa, avísele a quien administra la plataforma.", 409);
  }
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
    // El cambio de plan surte efecto hoy: queda la fecha para cuadrar la siguiente nota de cobro.
    summary: input.plan && input.plan !== org.plan
      ? `${org.name}: plan ${org.plan} → ${input.plan}, efectivo el ${new Date().toLocaleDateString("es-MX", { timeZone: "America/Monterrey" })}`
      : `${org.name}: ${JSON.stringify(input)}`,
    changes: { ...input, efectivoEl: new Date().toISOString() },
  });

  return ok({ organization: actualizada });
}
