/**
 * Bloque 3 — Sesiones, contraseñas, archivos, planes y bitacora, por HTTP.
 *
 * Lo que aqui se prueba no se puede probar llamando a `lib/`: son cosas que
 * pasan ENTRE peticiones —una sesion que sigue abierta, una liga que ya se
 * uso, un limite que ya se alcanzo—. Se firma la sesion igual que el navegador
 * y se llama a las rutas de verdad.
 *
 *   npx tsx scripts/prueba-acceso.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { hashPassword } from "../lib/auth";
import { FALLOS_MAXIMOS } from "../lib/acceso";
import { apagarServidor } from "./apagar-servidor";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle)}` : ""}`);
}

function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}

async function esperarServidor(base: string, limiteMs: number) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) });
      if (r.status < 500) return;
    } catch { /* todavia no levanta */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

async function main() {
  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3200";
  if (!process.env.BASE_URL) {
    servidor = spawn("npx", ["next", "dev", "-p", "3200", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
  }

  const sello = `acc-${Date.now()}`;
  const secreto = new TextEncoder().encode(llaveDeSesion());
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" },
  });

  /**
   * Una sesion firmada igual que la del navegador.
   *
   * `segundosAntes` sirve para representar lo que de verdad pasa: la sesion que
   * hay que cortar se abrio antes —ayer, en otro aparato—, no en el mismo
   * segundo en que administracion hace el cambio.
   */
  const sesion = async (u: { id: string; email: string; name: string; role: string }, segundosAntes = 0) =>
    `mt_session=${await new SignJWT({ userId: u.id, organizationId: org.id, email: u.email, name: u.name, role: u.role })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - segundosAntes)
      .setExpirationTime("1h")
      .sign(secreto)}`;

  try {
    await esperarServidor(base, 240_000);

    const clave = "clave-de-prueba-123";
    const dueño = await prisma.user.create({
      data: { organizationId: org.id, email: `duena-${sello}@t.mx`, name: "Dueña", role: "OWNER", passwordHash: await hashPassword(clave) },
    });
    const tecnico = await prisma.user.create({
      data: { organizationId: org.id, email: `tec-${sello}@t.mx`, name: "Técnico", role: "TECHNICIAN", passwordHash: await hashPassword(clave) },
    });

    const pedir = async (metodo: string, ruta: string, cookie: string | null, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      });
      const texto = await r.text();
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(texto); } catch { /* html */ }
      return { status: r.status, texto: texto.slice(0, 200), json };
    };

    console.log("\n1. La sesión de alguien desactivado deja de servir");
    const cookieTecnico = await sesion(tecnico, 120);
    revisar("con la sesión abierta, entra", (await pedir("GET", "/api/notifications", cookieTecnico)).status === 200);
    await pedir("PATCH", `/api/users/${tecnico.id}`, await sesion(dueño), { active: false });
    revisar("desactivado por administración, la MISMA sesión ya no sirve",
      (await pedir("GET", "/api/notifications", cookieTecnico)).status === 401);
    // Se reactiva y se limpia el corte: la seccion siguiente parte de una
    // persona normal, con sesiones validas, como cualquier dia.
    await prisma.user.update({ where: { id: tecnico.id }, data: { active: true, sessionsValidFrom: null } });

    console.log("\n2. Cambiar el rol o la contraseña cierra las sesiones abiertas");
    const cookieVieja = await sesion(tecnico, 120);
    revisar("la sesión funciona antes del cambio", (await pedir("GET", "/api/notifications", cookieVieja)).status === 200);
    await pedir("PATCH", `/api/users/${tecnico.id}`, await sesion(dueño), { role: "SUPERVISOR" });
    revisar("tras el cambio de rol, la sesión vieja queda invalidada",
      (await pedir("GET", "/api/notifications", cookieVieja)).status === 401);

    const cookiePropia = await sesion(dueño, 120);
    const rClave = await pedir("POST", "/api/account/password", cookiePropia, {
      currentPassword: clave, newPassword: "otra-clave-larga-456",
    });
    revisar("el dueño cambia su contraseña", rClave.status === 200, rClave.status);
    revisar("y su sesión anterior deja de servir",
      (await pedir("GET", "/api/notifications", cookiePropia)).status === 401);

    console.log("\n3. Ligas de restablecimiento: una sola vez y con vencimiento");
    const cookieDueño = await sesion(dueño);
    const rLiga = await pedir("POST", `/api/users/${tecnico.id}/restablecer`, cookieDueño);
    const token = String(rLiga.json.token ?? "");
    revisar("administración emite la liga", rLiga.status === 201 && token.length > 20, rLiga.status);
    revisar("un técnico NO puede emitir ligas",
      (await pedir("POST", `/api/users/${dueño.id}/restablecer`, await sesion({ ...tecnico, role: "TECHNICIAN" }))).status === 403);

    const rUso = await pedir("POST", "/api/auth/restablecer", null, { token, password: "clave-nueva-del-tecnico" });
    revisar("la liga sirve una vez", rUso.status === 200, rUso.texto.slice(0, 80));
    const rReuso = await pedir("POST", "/api/auth/restablecer", null, { token, password: "otra-mas" });
    revisar("y la segunda vez ya no", rReuso.status === 410, rReuso.status);

    const vencida = await pedir("POST", `/api/users/${tecnico.id}/restablecer`, cookieDueño);
    const tokenVencido = String(vencida.json.token ?? "");
    await prisma.passwordReset.updateMany({
      where: { userId: tecnico.id, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    revisar("una liga vencida no sirve",
      (await pedir("POST", "/api/auth/restablecer", null, { token: tokenVencido, password: "lo-que-sea-8" })).status === 410);
    revisar("un token inventado tampoco",
      (await pedir("POST", "/api/auth/restablecer", null, { token: "x".repeat(43), password: "lo-que-sea-8" })).status === 410);
    revisar("el token no se guarda en claro en la base",
      (await prisma.passwordReset.findMany({ where: { userId: tecnico.id }, select: { tokenHash: true } }))
        .every((r) => r.tokenHash !== token && r.tokenHash !== tokenVencido));

    console.log("\n4. La puerta se cierra tras varios intentos fallidos");
    const correo = `tec-${sello}@t.mx`;
    const rEntra = await pedir("POST", "/api/auth/login", null, { email: correo, password: "clave-nueva-del-tecnico" });
    revisar("con la contraseña nueva se entra", rEntra.status === 200, rEntra.texto.slice(0, 80));
    let ultimo = 0;
    for (let i = 0; i < FALLOS_MAXIMOS + 1; i++) {
      ultimo = (await pedir("POST", "/api/auth/login", null, { email: correo, password: "no-es-la-clave" })).status;
    }
    revisar("después de varios fallos responde 429, no 401", ultimo === 429, ultimo);
    const rBuena = await pedir("POST", "/api/auth/login", null, { email: correo, password: "clave-nueva-del-tecnico" });
    revisar("y ni siquiera con la contraseña correcta se pasa mientras dura el freno", rBuena.status === 429, rBuena.status);
    const rInventado = await pedir("POST", "/api/auth/login", null, { email: `nadie-${sello}@t.mx`, password: "x" });
    revisar("un correo inexistente responde igual que una contraseña mala (401, mismo texto)",
      rInventado.status === 401 && String(rInventado.json.error) === "Credenciales incorrectas", rInventado.json);
    revisar("los intentos quedan registrados sin la contraseña",
      (await prisma.accessAttempt.count({ where: { email: correo } })) > FALLOS_MAXIMOS);

    console.log("\n5. Archivos: solo con sesión y solo los propios");
    const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "SIT-S", name: "Planta" } });
    const activo = await prisma.asset.create({ data: { organizationId: org.id, code: "ACT-S1", name: "Equipo", siteId: sitio.id } });
    const adjunto = await prisma.attachment.create({
      data: {
        organizationId: org.id, assetId: activo.id, name: "manual.pdf",
        storagePath: `org-${org.id}/assets/archivo.pdf`, mimeType: "application/pdf", size: 10, kind: "DOCUMENT",
      },
    });
    revisar("sin sesión, 401", (await pedir("GET", `/api/attachments/${adjunto.id}`, null)).status === 401);
    revisar("el nombre del archivo guardado no revela rutas internas ni el nombre original",
      !adjunto.storagePath.includes("manual.pdf") && adjunto.storagePath.startsWith(`org-${org.id}/`));
    const traversal = encodeURIComponent(`org-${org.id}/../otra-empresa/secreto.pdf`);
    revisar("una ruta con «..» se rechaza",
      (await pedir("GET", `/api/attachments/local/${traversal}`, cookieDueño)).status === 403);

    console.log("\n6. El límite del plan se aplica en el servidor");
    const limite = 50; // usuarios del plan PROFESSIONAL
    const cuantos = await prisma.user.count({ where: { organizationId: org.id, active: true } });
    for (let i = cuantos; i < limite; i++) {
      await prisma.user.create({
        data: { organizationId: org.id, email: `relleno${i}-${sello}@t.mx`, name: `Relleno ${i}`, role: "VIEWER", passwordHash: "x" },
      });
    }
    const rCupo = await pedir("POST", "/api/users", cookieDueño, {
      name: "Uno de más", email: `demas-${sello}@t.mx`, password: "clavelarga123", role: "TECHNICIAN",
    });
    revisar("al llegar al tope, el alta se rechaza con mensaje claro",
      rCupo.status === 402 && /limite|límite/i.test(String(rCupo.json.error)), rCupo.json);

    // Desactivar y reactivar no puede ser la puerta trasera del limite.
    const relleno = await prisma.user.findFirstOrThrow({ where: { organizationId: org.id, name: "Relleno 49" } });
    await pedir("PATCH", `/api/users/${relleno.id}`, cookieDueño, { active: false });
    const rAlta = await pedir("POST", "/api/users", cookieDueño, {
      name: "Nuevo con hueco", email: `hueco-${sello}@t.mx`, password: "clavelarga123", role: "TECHNICIAN",
    });
    revisar("con un hueco libre, el alta pasa", rAlta.status === 201, rAlta.status);
    const rReactivar = await pedir("PATCH", `/api/users/${relleno.id}`, cookieDueño, { active: true });
    revisar("reactivar por encima del tope se rechaza (no es la puerta trasera del plan)",
      rReactivar.status === 402, { status: rReactivar.status, error: rReactivar.json.error });

    console.log("\n7. Exportar: con permiso, y queda en la bitácora");
    const soloLectura = await prisma.user.create({
      data: { organizationId: org.id, email: `vista-${sello}@t.mx`, name: "Consulta", role: "VIEWER", passwordHash: "x" },
    });
    revisar("un rol de consulta no exporta",
      (await pedir("GET", "/api/export/work-orders", await sesion(soloLectura))).status === 403);
    revisar("el dueño sí exporta", (await pedir("GET", "/api/export/work-orders", cookieDueño)).status === 200);
    revisar("la exportación quedó registrada",
      (await prisma.auditLog.count({ where: { organizationId: org.id, action: "EXPORTED" } })) >= 1);

    console.log("\n8. La bitácora tiene lo sensible, y no tiene secretos");
    const registros = await prisma.auditLog.findMany({
      where: { organizationId: org.id },
      select: { action: true, userId: true, entity: true, entityId: true, createdAt: true, changes: true, summary: true },
    });
    const acciones = new Set(registros.map((r) => r.action));
    for (const esperada of ["LOGIN", "LOGIN_FAILED", "USER_CREATED", "USER_ROLE_CHANGED", "USER_DEACTIVATED", "PASSWORD_CHANGED", "PASSWORD_RESET_ISSUED", "PASSWORD_RESET_USED", "EXPORTED"]) {
      revisar(`queda registrado: ${esperada}`, acciones.has(esperada), [...acciones].join(", ").slice(0, 120));
    }
    revisar("cada renglón dice quién, cuándo, en qué empresa y sobre qué registro",
      registros.every((r) => r.entity && r.entityId && r.createdAt) && registros.some((r) => r.userId));
    const texto = JSON.stringify(registros);
    revisar("no guarda contraseñas, tokens ni hashes",
      !texto.includes(clave) && !texto.includes(token) && !/\$2[aby]\$/.test(texto) && !texto.includes("passwordHash"));
  } finally {
    await prisma.accessAttempt.deleteMany({ where: { email: { contains: sello } } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    if (servidor?.pid) {
      await apagarServidor(servidor, 3200);
    }
  }

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
