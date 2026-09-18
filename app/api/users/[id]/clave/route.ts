import { z } from "zod";
import { avisarContrasena } from "@/lib/avisos/cuenta";
import { prisma } from "@/lib/db";
import { fail, ok, withAuth } from "@/lib/api";
import { hashPassword, revocarSesiones } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { LARGO_MINIMO_CLAVE, puedeReponerClave } from "@/lib/reponer-clave";

const schema = z.object({
  nuevaClave: z.string().min(LARGO_MINIMO_CLAVE, `La contraseña debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres`),
});

/**
 * Reponer la contraseña de otra persona de la empresa.
 *
 * Sin esto, quien olvidaba su contraseña quedaba fuera para siempre: no hay
 * correo de recuperacion, y la contraseña solo se definia al crear el usuario.
 * La unica salida era crearle otro usuario y abandonar el anterior, perdiendo
 * el historial de sus actividades, sus horas y sus reportes.
 *
 * Va en su propia ruta y no como un campo mas del PATCH general: una
 * contraseña no es un dato mas del perfil. Aparte se audita distinto, se
 * revisa distinto, y no se cuela por accidente en una edicion de rol o tarifa.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth("user:manage", async ({ user, orgId }) => {
    const objetivo = await prisma.user.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    if (!objetivo) return fail("Usuario no encontrado", 404);

    // La regla vive en lib/reponer-clave.ts, que es lo que ejercita la prueba.
    const veredicto = puedeReponerClave({ id: user.id, role: user.role }, objetivo);
    if (!veredicto.puede) return fail(veredicto.motivo, veredicto.codigo);

    const input = schema.parse(await request.json());
    await prisma.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(input.nuevaClave) },
    });
    // Reponer la contrasena tambien cierra las sesiones de esa persona: es
    // justo el caso de «se fue y dejo la sesion abierta».
    await revocarSesiones(id);

    /**
     * Queda registrado QUIEN la repuso y a quien, nunca el valor.
     *
     * Es el registro que permite responder despues "¿quien le dio acceso a esta
     * cuenta?". Sin el, reponer contraseñas seria una puerta sin bitacora.
     */
    await logAudit({
      organizationId: orgId,
      userId: user.id,
      entity: "User",
      entityId: objetivo.id,
      action: "PASSWORD_RESET",
      summary: `${user.name} repuso la contraseña de ${objetivo.name} (${objetivo.email})`,
    });
    await avisarContrasena(orgId, objetivo.id, `La repuso ${user.name}.`);

    return ok({ success: true, usuario: { name: objetivo.name, email: objetivo.email } });
  });
}
