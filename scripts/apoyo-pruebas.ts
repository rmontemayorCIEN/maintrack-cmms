/**
 * Lo que comparten las pruebas que necesitan un servidor y SESIONES DE VERDAD.
 *
 * Las pruebas anteriores firmaban la cookie de sesion ellas mismas. Eso
 * ejercita la aplicacion, pero no el inicio de sesion: si mañana el login
 * rechazara a un rol, esas pruebas no se enterarian. Aqui cada cuenta entra
 * por `/api/auth/login` con su contrasena, como una persona.
 *
 * Nada de esto toca produccion: levanta su propio servidor contra la base de
 * desarrollo y trabaja con empresas que crea y borra.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db";

/** Los siete roles del sistema, con la cuenta que los representa. */
export const ROLES_DE_PRUEBA = [
  { rol: "OWNER", nombre: "Propietario" },
  { rol: "ADMIN", nombre: "Administrador" },
  { rol: "SUPERVISOR", nombre: "Supervisor" },
  { rol: "TECHNICIAN", nombre: "Técnico" },
  { rol: "COMPRAS", nombre: "Compras" },
  { rol: "REQUESTER", nombre: "Solicitante" },
  { rol: "VIEWER", nombre: "Consulta" },
] as const;

export type RolDePrueba = (typeof ROLES_DE_PRUEBA)[number]["rol"];

/** La llave de sesion, del entorno o del .env, como la lee la aplicacion. */
export function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}

export async function esperarServidor(base: string, limiteMs = 240_000) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try { const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) }); if (r.status < 500) return; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

export function levantarServidor(puerto: number): ChildProcess | null {
  if (process.env.BASE_URL) return null;
  return spawn("npx", ["next", "dev", "-p", String(puerto), "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
}

export type Respuesta = { status: number; json: Record<string, unknown>; texto: string };

/** Una peticion con sesion, devolviendo cuerpo y estado para poder asentarlos como evidencia. */
export async function pedir(
  base: string, metodo: string, ruta: string,
  cab: Record<string, string>, cuerpo?: unknown,
): Promise<Respuesta> {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...cab },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    redirect: "manual",
  });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texto) as Record<string, unknown>; } catch { /* html */ }
  return { status: r.status, json, texto };
}

/**
 * Entra por la puerta de verdad y devuelve la cookie.
 *
 * Si el login falla, se revienta con el motivo: una prueba que sigue adelante
 * sin sesion reporta «sin permiso» en todo y manda a buscar el problema donde
 * no esta.
 */
export async function entrar(base: string, correo: string, contrasena: string): Promise<Record<string, string>> {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: correo, password: contrasena }),
    redirect: "manual",
  });
  const cookie = r.headers.get("set-cookie");
  if (!r.ok || !cookie) {
    throw new Error(`No se pudo entrar como ${correo}: ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
  return { Cookie: cookie.split(";")[0] };
}

/** Una empresa con sus siete cuentas, cada una con contrasena real. */
export async function empresaConRoles(sello: string, contrasena: string) {
  const org = await prisma.organization.create({
    data: {
      name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE",
      timezone: "America/Monterrey", diasHabiles: "1,2,3,4,5,6,7",
    },
  });
  const hash = await bcrypt.hash(contrasena, 10);
  const cuentas: Record<string, { id: string; email: string }> = {};
  for (const { rol } of ROLES_DE_PRUEBA) {
    const correo = `${rol.toLowerCase()}-${sello}@prueba.mx`;
    const u = await prisma.user.create({
      data: { organizationId: org.id, email: correo, name: rol, role: rol, passwordHash: hash, hourlyRate: 100 },
    });
    cuentas[rol] = { id: u.id, email: correo };
  }
  return { org, cuentas };
}

/** Borra lo que la prueba creo, sin tocar nada mas. */
export async function borrarEmpresas(ids: string[]) {
  for (const id of ids) {
    await prisma.workOrder.deleteMany({ where: { organizationId: id } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id } }).catch(() => undefined);
  }
}

/**
 * Foto de TODO lo que no es de esta prueba.
 *
 * Se compara al principio y al final: si una prueba toca datos de otra
 * empresa —el error mas caro de un sistema multiempresa—, aqui se ve.
 */
export async function fotoDeLasDemas(excepto: string[]) {
  const where = { organizationId: { notIn: excepto } };
  return JSON.stringify(await Promise.all([
    prisma.workOrder.count({ where }), prisma.workRequest.count({ where }),
    prisma.stockMovement.count({ where }), prisma.notification.count({ where }),
    prisma.auditLog.count({ where }), prisma.attachment.count({ where }),
    prisma.purchaseRequest.count({ where }), prisma.meterReading.count({ where }),
  ]));
}
