/**
 * Avisos de administración de la cuenta: personas y contraseñas.
 *
 * Van a los destinatarios administrativos de la empresa (o dueño y
 * administradores si no eligió). El cambio de contraseña va SOLO a la
 * persona dueña de la cuenta: es la alerta de seguridad «si no fue usted,
 * avise». Nunca llevan la contraseña ni su hash.
 */
import { prisma } from "../db";
import { emitirAviso } from "./emitir";

export async function avisarAltaDeUsuario(organizationId: string, u: { id: string; name: string; role: string }) {
  await emitirAviso({
    organizationId, tipo: "USUARIO_NUEVO", entidad: "User", entidadId: u.id,
    titulo: `Alta de ${u.name}`, cuerpo: `Rol: ${u.role}.`, enlace: "/settings?s=usuarios",
  });
}

export async function avisarCambioDeUsuario(
  organizationId: string,
  u: { id: string; name: string },
  antes: { role: string; active: boolean },
  despues: { role: string; active: boolean },
) {
  if (antes.active && !despues.active) {
    const abiertas = await prisma.workOrder.count({
      where: { organizationId, assignedToId: u.id, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] } },
    });
    await emitirAviso({
      organizationId, tipo: "USUARIO_DESACTIVADO", entidad: "User", entidadId: u.id, version: new Date().toISOString().slice(0, 16),
      titulo: `${u.name} fue desactivado`,
      cuerpo: abiertas ? `Tiene ${abiertas} orden(es) abierta(s) a su cargo: sus avisos ahora van a supervisión.` : undefined,
      accion: abiertas ? "Reasigne sus órdenes abiertas." : undefined, enlace: "/work-orders",
    });
  }
  if (antes.role !== despues.role) {
    await emitirAviso({
      organizationId, tipo: "ROL_CAMBIADO", entidad: "User", entidadId: u.id, version: `${antes.role}->${despues.role}`,
      titulo: `Cambio de rol: ${u.name}`, cuerpo: `${antes.role} → ${despues.role}. Sus sesiones abiertas se cerraron.`,
      enlace: "/settings?s=usuarios",
      // Le llega a la persona y también a la administración: los dos eslabones a la vez.
      grupos: [["USUARIO_AFECTADO", "ADMINISTRADORES"]], contexto: { usuarioAfectadoId: u.id },
    });
  }
}

/** Contraseña cambiada o restablecida: aviso de seguridad a la dueña de la cuenta. */
export async function avisarContrasena(organizationId: string, userId: string, como: string) {
  await emitirAviso({
    organizationId, tipo: "CONTRASENA_CAMBIADA", entidad: "User", entidadId: userId, version: new Date().toISOString(),
    titulo: "Su contraseña cambió", cuerpo: como,
    porQue: "Si no fue usted, alguien más puede estar entrando con su cuenta.",
    accion: "Si no la cambió usted, avise de inmediato a su administrador.",
    enlace: "/settings?s=cuenta", contexto: { usuarioAfectadoId: userId },
  });
}
