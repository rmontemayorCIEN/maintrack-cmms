import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { estaFrenado, registrarIntento } from "@/lib/acceso";
import { logAudit } from "@/lib/audit";
import { fail, ok } from "@/lib/api";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

/** El mismo texto para correo inexistente y clave equivocada: no se confirma quien tiene cuenta. */
const GENERICO = "Credenciales incorrectas";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Correo o contraseña invalidos", 422);

  const email = parsed.data.email.toLowerCase().trim();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Probar contrasenas una tras otra deja de ser gratis.
  const freno = await estaFrenado(email);
  if (freno.frenado) {
    await registrarIntento({ email, ip, exito: false, motivo: "BLOQUEADO" });
    return fail(`Demasiados intentos fallidos. Vuelva a intentar en ${freno.minutos} minuto(s).`, 429);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { organization: true },
  });
  if (!user || !user.active) {
    await registrarIntento({ email, ip, exito: false, motivo: "SIN_CUENTA" });
    return fail(GENERICO, 401);
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    await registrarIntento({ email, ip, exito: false, motivo: "CLAVE_MAL" });
    await logAudit({
      organizationId: user.organizationId, userId: user.id,
      entity: "User", entityId: user.id, action: "LOGIN_FAILED",
      summary: `Intento de acceso fallido de ${user.email}`,
    });
    return fail(GENERICO, 401);
  }
  if (user.organization.status === "SUSPENDED") {
    await registrarIntento({ email, ip, exito: false, motivo: "EMPRESA_SUSPENDIDA" });
    return fail("La organización esta suspendida", 403);
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await registrarIntento({ email, ip, exito: true, motivo: "OK" });
  await logAudit({
    organizationId: user.organizationId, userId: user.id,
    entity: "User", entityId: user.id, action: "LOGIN",
    summary: `${user.name} inició sesión`,
  });
  await createSession({
    userId: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  return ok({ user: { id: user.id, name: user.name, role: user.role } });
}
