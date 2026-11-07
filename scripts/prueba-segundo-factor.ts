/**
 * Segundo factor del operador de la plataforma (ISO 27001, 8.5), por HTTP y
 * con sesiones de verdad: sin él no opera; se activa con contraseña y código;
 * entrar pide el código; un código no sirve dos veces; los de respaldo se
 * gastan; el desafío no sirve como sesión; apagarlo vuelve a cerrar.
 *
 *   npx tsx scripts/prueba-segundo-factor.ts
 *
 * Usa la base de desarrollo y borra lo que crea.
 */
import bcrypt from "bcryptjs";
import type { ChildProcess } from "node:child_process";
import { prisma } from "../lib/db";
import { codigoDelPaso, deBase32, pasoDe, verificarCodigo } from "../lib/totp";
import { apagarServidor, colaDelLog, levantarServidor } from "./servidor-de-prueba";
import { esperarServidor } from "./apoyo-pruebas";

const PUERTO = 3238;
const base = process.env.BASE_URL ?? `http://127.0.0.1:${PUERTO}`;
const CLAVE = "Prueba-2FA-2026!";

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${!bien && d ? ` · ${d.slice(0, 300)}` : ""}`);
  if (!bien) fallas++;
}

async function http(metodo: string, ruta: string, o: { cookie?: string; cuerpo?: unknown } = {}) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo, redirect: "manual",
    headers: { "Content-Type": "application/json", ...(o.cookie ? { Cookie: o.cookie } : {}) },
    body: o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo),
  });
  const texto = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: r.status, json, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? null };
}
const codigo = (clave: string, desfasePasos = 0) => codigoDelPaso(deBase32(clave)!, pasoDe(new Date()) + desfasePasos);

async function main() {
  // Los vectores del RFC 6238 (SHA-1): la implementación se comprueba contra el estándar.
  const rfc = new TextEncoder().encode("12345678901234567890");
  revisar("TOTP: vector del RFC 6238 en t=59", codigoDelPaso(rfc, Math.floor(59 / 30)) === "287082");
  revisar("TOTP: vector del RFC 6238 en t=1111111109", codigoDelPaso(rfc, Math.floor(1111111109 / 30)) === "081804");
  revisar("TOTP: un paso ya usado no se acepta", !verificarCodigo("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", codigoDelPaso(rfc, 100), new Date(100 * 30_000), 100).ok);

  const sello = `2fa-${Date.now()}`;
  const org = await prisma.organization.create({ data: { name: `Operador ${sello}`, slug: sello, cuentaInterna: true } });
  const operador = await prisma.user.create({
    data: { organizationId: org.id, email: `op-${sello}@prueba.mx`, name: "Operador", role: "OWNER", isSuperAdmin: true, passwordHash: await bcrypt.hash(CLAVE, 10) },
  });
  let servidor: ChildProcess | null = null;
  try {
    if (!process.env.BASE_URL) servidor = levantarServidor({ puerto: PUERTO });
    await esperarServidor(base);

    console.log("\nSin segundo factor, el operador no opera");
    let r = await http("POST", "/api/auth/login", { cuerpo: { email: operador.email, password: CLAVE } });
    revisar("entra con su contraseña (sin bloquearlo fuera de su cuenta)", r.status === 200 && Boolean(r.cookie), r);
    const sesion1 = r.cookie!;
    r = await http("GET", "/api/admin/organizations", { cookie: sesion1 });
    revisar("pero las rutas del operador contestan 403 y dicen dónde activarlo", r.status === 403 && String(r.json.error).includes("segundo factor"), r);

    console.log("\nActivarlo");
    r = await http("POST", "/api/account/segundo-factor", { cookie: sesion1, cuerpo: { accion: "empezar", password: "otra" } });
    revisar("con la contraseña equivocada no empieza", r.status === 403, r);
    r = await http("POST", "/api/account/segundo-factor", { cookie: sesion1, cuerpo: { accion: "empezar", password: CLAVE } });
    const clave = String(r.json.clave ?? "").replace(/\s/g, "");
    revisar("con la buena da la clave, la URI y el QR", r.status === 200 && clave.length >= 32 && String(r.json.qr).startsWith("data:image/png"), r.status);
    r = await http("GET", "/api/admin/organizations", { cookie: sesion1 });
    revisar("empezar no basta: sin confirmar sigue sin operar", r.status === 403);
    r = await http("POST", "/api/account/segundo-factor", { cookie: sesion1, cuerpo: { accion: "confirmar", codigo: "000000" === codigo(clave) ? "111111" : "000000" } });
    revisar("un código equivocado no lo activa", r.status === 422, r);
    r = await http("POST", "/api/account/segundo-factor", { cookie: sesion1, cuerpo: { accion: "confirmar", codigo: codigo(clave) } });
    const respaldos = (r.json.respaldos as string[]) ?? [];
    revisar("el código bueno lo activa y entrega 10 códigos de respaldo", r.status === 200 && respaldos.length === 10, r);
    const guardado = await prisma.user.findUnique({ where: { id: operador.id }, select: { totpSecreto: true, totpRespaldos: true } });
    revisar("el secreto se guarda cifrado, no en claro", Boolean(guardado?.totpSecreto) && !guardado!.totpSecreto!.includes(clave));
    revisar("los respaldos se guardan como huellas, no en claro", !respaldos.some((x) => guardado?.totpRespaldos?.includes(x)));
    r = await http("GET", "/api/admin/organizations", { cookie: sesion1 });
    revisar("ya activo, opera", r.status === 200, r.status);

    console.log("\nEntrar con segundo factor");
    r = await http("POST", "/api/auth/login", { cuerpo: { email: operador.email, password: CLAVE } });
    const desafio = String(r.json.desafio ?? "");
    revisar("la contraseña sola ya no da sesión: devuelve un desafío", r.status === 200 && r.json.segundoFactor === true && desafio.length > 20 && !r.cookie, r);
    r = await http("GET", "/api/admin/organizations", { cookie: `mt_session=${desafio}` });
    revisar("el desafío puesto como cookie no es una sesión", r.status === 401, r.status);
    r = await http("POST", "/api/auth/segundo-factor", { cuerpo: { desafio, codigo: "000000" === codigo(clave, 1) ? "111111" : "000000" } });
    revisar("un código equivocado no entra", r.status === 401 && !r.cookie, r);
    // El código de confirmar ya se usó: el siguiente paso sí vale (tolerancia de ±1).
    const siguiente = codigo(clave, 1);
    r = await http("POST", "/api/auth/segundo-factor", { cuerpo: { desafio, codigo: siguiente } });
    revisar("el código de la aplicación entra", r.status === 200 && Boolean(r.cookie), r);
    r = await http("GET", "/api/admin/organizations", { cookie: r.cookie ?? "" });
    revisar("y la sesión opera", r.status === 200);
    r = await http("POST", "/api/auth/segundo-factor", { cuerpo: { desafio, codigo: siguiente } });
    revisar("el mismo código no sirve dos veces", r.status === 401, r);

    console.log("\nCódigos de respaldo");
    r = await http("POST", "/api/auth/segundo-factor", { cuerpo: { desafio, codigo: respaldos[0] } });
    revisar("uno de respaldo entra", r.status === 200 && Boolean(r.cookie), r);
    r = await http("POST", "/api/auth/segundo-factor", { cuerpo: { desafio, codigo: respaldos[0] } });
    revisar("y no sirve dos veces", r.status === 401, r);
    r = await http("POST", "/api/auth/segundo-factor", { cuerpo: { desafio: "x".repeat(40), codigo: respaldos[1] } });
    revisar("sin un desafío válido no hay segundo paso", r.status === 401, r);
    const bitacora = await prisma.auditLog.count({ where: { userId: operador.id, action: "LOGIN", summary: { contains: "código de respaldo" } } });
    revisar("la entrada con código de respaldo queda dicha en la bitácora", bitacora === 1, bitacora);

    console.log("\nApagarlo");
    r = await http("POST", "/api/account/segundo-factor", { cookie: sesion1, cuerpo: { accion: "quitar", password: CLAVE } });
    revisar("con la contraseña se apaga", r.status === 200, r);
    r = await http("GET", "/api/admin/organizations", { cookie: sesion1 });
    revisar("y el operador vuelve a no operar", r.status === 403);
    revisar("activarlo y apagarlo quedan en la bitácora", (await prisma.auditLog.count({ where: { userId: operador.id, action: { in: ["SECOND_FACTOR_ENABLED", "SECOND_FACTOR_DISABLED"] } } })) === 2);
  } finally {
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.accessAttempt.deleteMany({ where: { email: operador.email } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    if (servidor) await apagarServidor(servidor, PUERTO);
    if (fallas && !process.env.BASE_URL) console.log(`\n── Log del servidor ──\n${colaDelLog(PUERTO)}`);
  }
  console.log(`\n${fallas ? `${fallas} FALLAS` : "todo en verde"}\n`);
  await prisma.$disconnect();
  process.exit(fallas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
