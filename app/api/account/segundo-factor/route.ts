import { z } from "../../../../lib/zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { fail, leerCuerpo, ok } from "@/lib/api";
import { confirmarAlta, empezarAlta, exigeSegundoFactor, quitar } from "@/lib/segundo-factor";

const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("empezar"), password: z.string().min(1).max(200) }),
  z.object({ accion: z.literal("confirmar"), codigo: z.string().trim().min(6).max(8) }),
  z.object({ accion: z.literal("quitar"), password: z.string().min(1).max(200) }),
]);

/**
 * Alta y baja del segundo factor de la propia cuenta. Por ahora solo para el
 * operador de la plataforma (a él se le exige). Empezar y quitar piden la
 * contraseña: una sesión abierta ajena no debe poder cambiarlo.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("No autenticado", 401);
  if (!exigeSegundoFactor(user)) return fail("El segundo factor está disponible para el operador de la plataforma.", 403);
  const cuerpo = await leerCuerpo(request, schema);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const d = cuerpo.datos;
  const yo = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, organizationId: true } });

  if (d.accion === "empezar" || d.accion === "quitar") {
    if (!(await verifyPassword(d.password, yo.passwordHash))) return fail("La contraseña no es correcta", 403);
  }
  if (d.accion === "empezar") return ok(await empezarAlta({ id: user.id, email: user.email }));

  const anotar = (action: string, summary: string) =>
    logAudit({ organizationId: yo.organizationId, userId: user.id, entity: "User", entityId: user.id, action, summary });

  if (d.accion === "confirmar") {
    const r = await confirmarAlta(user.id, d.codigo);
    if (!r.ok) return fail(r.motivo, 422);
    await anotar("SECOND_FACTOR_ENABLED", "Activó su segundo factor");
    return ok({ respaldos: r.respaldos });
  }
  await quitar(user.id);
  await anotar("SECOND_FACTOR_DISABLED", "Apagó su segundo factor");
  return ok({ quitado: true });
}
