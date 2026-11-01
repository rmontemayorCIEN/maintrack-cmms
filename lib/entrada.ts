import { prisma } from "./db";
import { createSession } from "./auth";
import { registrarIntento } from "./acceso";
import { logAudit } from "./audit";

/**
 * Lo que pasa cuando alguien termina de entrar: con la contrasena sola, o con
 * contrasena y segundo factor. Un solo lugar para las dos rutas, para que la
 * bitacora y la sesion no difieran segun el camino.
 */
export async function completarEntrada(
  user: { id: string; organizationId: string; email: string; name: string; role: string },
  ip: string | null,
  conSegundoFactor: "app" | "respaldo" | null = null,
) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await registrarIntento({ email: user.email, ip, exito: true, motivo: "OK" });
  await logAudit({
    organizationId: user.organizationId, userId: user.id,
    entity: "User", entityId: user.id, action: "LOGIN",
    summary: `${user.name} inició sesión${conSegundoFactor === "respaldo" ? " con un código de respaldo" : conSegundoFactor ? " con segundo factor" : ""}`,
  });
  await createSession({
    userId: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}
