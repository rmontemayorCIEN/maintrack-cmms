/**
 * La puerta de entrada: intentos de acceso y restablecimiento de contrasena.
 *
 * Tres decisiones que valen mas que el codigo:
 *
 *  1. **El mensaje no dice si el correo existe.** «Credenciales incorrectas»
 *     tanto para un correo inventado como para una contrasena equivocada. Si el
 *     sistema distingue, cualquiera puede averiguar quien tiene cuenta.
 *  2. **El token de restablecimiento no se guarda.** Se guarda su hash. Quien
 *     vea la base no puede entrar con lo que ahi lee, y la liga sirve UNA vez.
 *  3. **El freno cuenta intentos, no sesiones.** Diez fallos en quince minutos
 *     para el mismo correo cierran la puerta un rato. Sin eso, probar
 *     contrasenas es gratis.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { avisarContrasena } from "./avisos/cuenta";
import { prisma } from "./db";
import { hashPassword, revocarSesiones } from "./auth";
import { logAudit } from "./audit";

export class ErrorDeAcceso extends Error {
  constructor(message: string, readonly codigo = 400) {
    super(message);
  }
}

/** Fallos tolerados por correo antes de cerrar la puerta, y por cuanto tiempo. */
export const FALLOS_MAXIMOS = 10;
export const VENTANA_MINUTOS = 15;

/** Vida de una liga de restablecimiento. Corta a proposito: se usa y se acaba. */
export const VIGENCIA_RESET_MINUTOS = 60;

const normalizar = (email: string) => email.toLowerCase().trim();

/** El hash con el que se guarda y se busca un token. Nunca el token en claro. */
export const huellaDeToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function registrarIntento(params: {
  email: string;
  ip?: string | null;
  exito: boolean;
  motivo: string;
}) {
  await prisma.accessAttempt.create({
    data: { email: normalizar(params.email), ip: params.ip ?? null, exito: params.exito, motivo: params.motivo },
  }).catch(() => undefined); // el registro no puede impedir entrar
}

/**
 * Si este correo esta frenado por intentos fallidos.
 *
 * Se cuentan solo los fallos posteriores al ultimo acceso bueno: quien se
 * equivoco tres veces y luego entro, empieza de cero.
 */
export async function estaFrenado(email: string): Promise<{ frenado: boolean; minutos: number }> {
  const desde = new Date(Date.now() - VENTANA_MINUTOS * 60_000);
  const intentos = await prisma.accessAttempt.findMany({
    where: { email: normalizar(email), createdAt: { gte: desde } },
    orderBy: { createdAt: "desc" },
    select: { exito: true, createdAt: true },
  });
  let fallos = 0;
  for (const i of intentos) {
    if (i.exito) break;
    fallos++;
  }
  if (fallos < FALLOS_MAXIMOS) return { frenado: false, minutos: 0 };
  const masViejo = intentos[Math.min(fallos, intentos.length) - 1].createdAt.getTime();
  const restan = Math.ceil((masViejo + VENTANA_MINUTOS * 60_000 - Date.now()) / 60_000);
  return { frenado: true, minutos: Math.max(1, restan) };
}

// ────────────────────────────── Restablecimiento ──────────────────────────

/**
 * Emite una liga de restablecimiento para una persona de MI organizacion.
 *
 * Todavia no hay correo saliente —mandar desde un dominio prestado termina en
 * spam—, asi que la liga se la entrega la administracion a su gente. Eso no la
 * hace menos segura: vence, sirve una sola vez y al usarla tumba las sesiones
 * abiertas de esa persona.
 *
 * Devuelve el token EN CLARO una sola vez. No se puede volver a consultar.
 */
export async function emitirRestablecimiento(params: {
  organizationId: string;
  userId: string;
  emitidoPorId: string;
}) {
  const persona = await prisma.user.findFirst({
    where: { id: params.userId, organizationId: params.organizationId },
    select: { id: true, name: true, email: true, active: true },
  });
  // Una liga jamas cruza de una empresa a otra: se busca dentro de la propia.
  if (!persona) throw new ErrorDeAcceso("Usuario no encontrado", 404);
  if (!persona.active) throw new ErrorDeAcceso("Esa persona esta desactivada: actívela antes de darle acceso", 409);

  // Las anteriores dejan de servir: una sola liga viva por persona.
  await prisma.passwordReset.updateMany({
    where: { userId: persona.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: {
      organizationId: params.organizationId,
      userId: persona.id,
      tokenHash: huellaDeToken(token),
      expiresAt: new Date(Date.now() + VIGENCIA_RESET_MINUTOS * 60_000),
      createdById: params.emitidoPorId,
    },
  });

  await logAudit({
    organizationId: params.organizationId,
    userId: params.emitidoPorId,
    entity: "User",
    entityId: persona.id,
    action: "PASSWORD_RESET_ISSUED",
    summary: `Liga de restablecimiento emitida para ${persona.name}`,
    // El token NO va a la bitacora: quien la lea no debe poder usarlo.
    changes: { vigenciaMinutos: VIGENCIA_RESET_MINUTOS },
  });

  return { token, expiraEn: VIGENCIA_RESET_MINUTOS, persona: { id: persona.id, name: persona.name, email: persona.email } };
}

/** Lo que se puede decir de una liga sin exponer de quien es. */
export async function revisarRestablecimiento(token: string) {
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: huellaDeToken(token) },
    select: { id: true, usedAt: true, expiresAt: true, user: { select: { name: true, active: true } } },
  });
  if (!reset || reset.usedAt || reset.expiresAt < new Date() || !reset.user.active) return null;
  return { nombre: reset.user.name };
}

/**
 * Usa la liga y cambia la contrasena.
 *
 * Un solo uso: se marca `usedAt` con una escritura condicional, de modo que dos
 * envios simultaneos no la gasten dos veces. Al terminar, las sesiones abiertas
 * de esa persona quedan revocadas: si alguien mas tenia acceso, lo pierde.
 */
export async function usarRestablecimiento(token: string, nuevaClave: string) {
  if (nuevaClave.trim().length < 8) {
    throw new ErrorDeAcceso("La contraseña debe tener al menos 8 caracteres", 422);
  }
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: huellaDeToken(token) },
    select: { id: true, userId: true, organizationId: true, usedAt: true, expiresAt: true },
  });
  // El mismo mensaje para «no existe», «ya se uso» y «vencio»: no tiene por que
  // saberse cual de las tres.
  const invalida = new ErrorDeAcceso("Esta liga ya no sirve. Pida una nueva a su administrador.", 410);
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) throw invalida;

  const gastada = await prisma.passwordReset.updateMany({
    where: { id: reset.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (gastada.count === 0) throw invalida;

  await prisma.user.update({
    where: { id: reset.userId },
    data: { passwordHash: await hashPassword(nuevaClave) },
  });
  await revocarSesiones(reset.userId);

  await logAudit({
    organizationId: reset.organizationId,
    userId: reset.userId,
    entity: "User",
    entityId: reset.userId,
    action: "PASSWORD_RESET_USED",
    summary: "Contraseña restablecida con liga de un solo uso; sesiones anteriores cerradas",
  });
  await avisarContrasena(reset.organizationId, reset.userId, "Se restableció con una liga de un solo uso.");
  return { ok: true };
}

/** Comparacion de cadenas en tiempo constante, para lo que sea secreto. */
export function igualSeguro(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
