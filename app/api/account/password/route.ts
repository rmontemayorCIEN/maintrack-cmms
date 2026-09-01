import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "La contraseña nueva debe tener al menos 8 caracteres"),
});

/**
 * Cambio de contraseña propia. Se exige la contraseña actual: sin eso, quien
 * tomara una sesion abierta podria dejar al dueño fuera de su propia cuenta.
 */
export async function POST(request: Request) {
  return withAuth(null, async ({ user, orgId }) => {
    const input = schema.parse(await request.json());

    const valida = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!valida) return fail("La contraseña actual no es correcta", 403);

    if (input.currentPassword === input.newPassword) {
      return fail("La contraseña nueva debe ser distinta de la actual", 422);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.newPassword) },
    });

    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "User",
      entityId: user.id,
      action: "PASSWORD_CHANGED",
      summary: `${user.name} cambio su contraseña`,
    });

    return ok({ success: true });
  });
}
