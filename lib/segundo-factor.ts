/**
 * Segundo factor del operador de la plataforma (ISO 27001, 8.5).
 *
 * El operador entra a TODAS las empresas cliente: su contrasena sola no debe
 * bastar. Codigo TOTP de aplicacion autenticadora (lib/totp.ts, el mismo de la
 * Torre de Control, probado contra los vectores del RFC) y diez codigos de
 * respaldo de un solo uso.
 *
 * ── El secreto, cifrado ──
 * AES-256-GCM con una llave DERIVADA de AUTH_SECRET (HKDF, etiqueta propia), que
 * ya vive en Secret Manager: no hace falta otro secreto. Consecuencia que hay que
 * saber: si se rota AUTH_SECRET, el secreto guardado ya no se puede leer y el
 * operador vuelve a dar de alta su segundo factor (`scripts/super-admin.ts
 * --quitar-segundo-factor`).
 *
 * Por ahora solo el operador lo usa; las demas cuentas siguen igual.
 */

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { prisma } from "./db";
import { claveLegible, secretoNuevo, uriDeEnrolamiento, verificarCodigo } from "./totp";

const EMISOR = "MainTrack";
const RESPALDOS = 10;

function llave(): Buffer {
  const base = process.env.AUTH_SECRET;
  if (!base || base.length < 32) throw new Error("AUTH_SECRET falta o es corto: sin él no se puede cifrar el segundo factor.");
  return Buffer.from(hkdfSync("sha256", base, "", "maintrack-segundo-factor-v1", 32));
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave(), iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), datos.toString("base64url")].join(".");
}

export function descifrar(cifrado: string): string {
  const [v, iv, etiqueta, datos] = cifrado.split(".");
  if (v !== "v1" || !iv || !etiqueta || !datos) throw new Error("Secreto con forma desconocida.");
  const d = createDecipheriv("aes-256-gcm", llave(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(etiqueta, "base64url"));
  return Buffer.concat([d.update(Buffer.from(datos, "base64url")), d.final()]).toString("utf8");
}

const huella = (codigo: string) => createHash("sha256").update(codigo.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

/** Diez bytes al azar en base32 sin las letras que se confunden, en dos bloques. */
function codigoDeRespaldo(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const letras = [...randomBytes(10)].map((b) => abc[b % abc.length]).join("");
  return `${letras.slice(0, 5)}-${letras.slice(5)}`;
}

/** Si a esta persona se le exige y si ya lo tiene. Un criterio, un lugar. */
export function exigeSegundoFactor(u: { isSuperAdmin: boolean }): boolean {
  return u.isSuperAdmin;
}

export function tieneSegundoFactor(u: { totpActivoEn: Date | null }): boolean {
  return u.totpActivoEn !== null;
}

/**
 * Paso 1 del alta: un secreto nuevo, guardado cifrado y SIN activar. Cada vez
 * que se empieza se genera otro: un secreto que quedo a medias en otra pantalla
 * no debe seguir sirviendo.
 */
export async function empezarAlta(usuario: { id: string; email: string }) {
  const secreto = secretoNuevo();
  await prisma.user.update({ where: { id: usuario.id }, data: { totpSecreto: cifrar(secreto), totpActivoEn: null, totpUltimoPaso: null, totpRespaldos: null } });
  const uri = uriDeEnrolamiento({ secreto, correo: usuario.email, emisor: EMISOR });
  return { uri, clave: claveLegible(secreto), qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/** Paso 2: el primer codigo lo activa y entrega los codigos de respaldo (se muestran UNA vez). */
export async function confirmarAlta(usuarioId: string, codigo: string, ahora = new Date()): Promise<{ ok: true; respaldos: string[] } | { ok: false; motivo: string }> {
  const u = await prisma.user.findUnique({ where: { id: usuarioId }, select: { totpSecreto: true, totpActivoEn: true } });
  if (!u?.totpSecreto) return { ok: false, motivo: "Primero genere la clave." };
  if (u.totpActivoEn) return { ok: false, motivo: "El segundo factor ya está activo." };
  const v = verificarCodigo(descifrar(u.totpSecreto), codigo, ahora);
  if (!v.ok) return { ok: false, motivo: "Ese código no coincide. Revise la hora del teléfono y use el más reciente." };
  const respaldos = Array.from({ length: RESPALDOS }, codigoDeRespaldo);
  await prisma.user.update({
    where: { id: usuarioId },
    data: { totpActivoEn: ahora, totpUltimoPaso: v.paso, totpRespaldos: JSON.stringify(respaldos.map(huella)) },
  });
  return { ok: true, respaldos };
}

/**
 * Comprueba un codigo al entrar: el de la aplicacion (y no uno ya usado) o uno
 * de respaldo, que se gasta. Devuelve si paso y de que tipo fue.
 */
export async function verificarAlEntrar(usuarioId: string, codigo: string, ahora = new Date()): Promise<"app" | "respaldo" | null> {
  const u = await prisma.user.findUnique({ where: { id: usuarioId }, select: { totpSecreto: true, totpActivoEn: true, totpUltimoPaso: true, totpRespaldos: true } });
  if (!u?.totpSecreto || !u.totpActivoEn) return null;
  const limpio = codigo.trim();
  if (/^\d{6}$/.test(limpio.replace(/\s/g, ""))) {
    const v = verificarCodigo(descifrar(u.totpSecreto), limpio, ahora, u.totpUltimoPaso);
    if (!v.ok) return null;
    // Solo avanza: dos peticiones con el mismo codigo no pasan las dos.
    const r = await prisma.user.updateMany({ where: { id: usuarioId, OR: [{ totpUltimoPaso: null }, { totpUltimoPaso: { lt: v.paso } }] }, data: { totpUltimoPaso: v.paso } });
    return r.count === 1 ? "app" : null;
  }
  const huellas: string[] = u.totpRespaldos ? JSON.parse(u.totpRespaldos) : [];
  const h = Buffer.from(huella(limpio));
  const usada = huellas.find((x) => x.length === h.length && timingSafeEqual(Buffer.from(x), h));
  if (!usada) return null;
  const quedan = JSON.stringify(huellas.filter((x) => x !== usada));
  // Se gasta solo si nadie la gasto antes (dos peticiones a la vez).
  const r = await prisma.user.updateMany({ where: { id: usuarioId, totpRespaldos: u.totpRespaldos }, data: { totpRespaldos: quedan } });
  return r.count === 1 ? "respaldo" : null;
}

/** Cuantos codigos de respaldo le quedan (para decirselo, no para mostrarlos). */
export function respaldosRestantes(u: { totpRespaldos: string | null }): number {
  return u.totpRespaldos ? (JSON.parse(u.totpRespaldos) as string[]).length : 0;
}

export async function quitar(usuarioId: string) {
  await prisma.user.update({ where: { id: usuarioId }, data: { totpSecreto: null, totpActivoEn: null, totpUltimoPaso: null, totpRespaldos: null } });
}
