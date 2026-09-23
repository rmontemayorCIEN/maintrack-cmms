/**
 * Iniciar una OT sin responsable, probado contra el SERVIDOR de verdad.
 *
 * `prueba-proceso-ot.ts` llama a `transitionWorkOrder` directo. Esta prueba va
 * un paso mas afuera: levanta la aplicacion, firma una sesion por rol como la
 * que da el inicio de sesion, y llama a `POST /api/work-orders/:id/status` y a
 * la pantalla de la orden, igual que el navegador. Asi se prueba tambien lo que
 * la ruta agrega: sesion, `withAuth`, lectura del rol desde la base, y el
 * aviso que la pantalla muestra a cada rol.
 *
 *   npx tsx scripts/prueba-http-inicio-sin-responsable.ts
 *   BASE_URL=http://localhost:3000 npx tsx scripts/prueba-http-inicio-sin-responsable.ts   (servidor ya corriendo)
 *
 * No debe correr al mismo tiempo que `npm run build` (comparten .next).
 */
import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { apagarServidor, levantarServidor } from "./servidor-de-prueba";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle)}` : ""}`);
}

/** La llave de sesion del entorno local, sin imprimirla nunca. */
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
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3197";
  if (!process.env.BASE_URL) {
    servidor = levantarServidor({ puerto: 3197 });
  }

  const sello = `prueba-http-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
  });
  const secreto = new TextEncoder().encode(llaveDeSesion());

  try {
    await esperarServidor(base, 240_000);

    const usuarios = Object.fromEntries(await Promise.all(
      ["TECHNICIAN", "SUPERVISOR", "ADMIN", "REQUESTER", "VIEWER"].map(async (rol) => {
        const u = await prisma.user.create({
          data: { organizationId: org.id, email: `${rol}-${sello}@t.mx`, name: `Persona ${rol}`, role: rol, passwordHash: "x" },
        });
        const token = await new SignJWT({ userId: u.id, organizationId: org.id, email: u.email, name: u.name, role: rol })
          .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto);
        return [rol, { id: u.id, cookie: `mt_session=${token}` }] as const;
      }),
    ));

    let folio = 0;
    const nuevaOt = () => prisma.workOrder.create({
      data: { organizationId: org.id, number: `OT-H${++folio}`, title: "Orden de prueba HTTP", status: "OPEN", estimatedHours: 1 },
    });
    const iniciar = async (id: string, rol: string, cuerpo: Record<string, unknown> = {}) => {
      const r = await fetch(`${base}/api/work-orders/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: usuarios[rol].cookie },
        body: JSON.stringify({ status: "IN_PROGRESS", ...cuerpo }),
        signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, cuerpo: await r.json().catch(() => null) as { error?: string } | null };
    };
    const orden = (id: string) => prisma.workOrder.findUniqueOrThrow({ where: { id }, include: { comments: true } });

    console.log("\n1. La ruta rechaza iniciar sin responsable");
    const o1 = await nuevaOt();
    let r = await iniciar(o1.id, "TECHNICIAN");
    revisar("técnico sin tomarla → 422 con explicación", r.status === 422 && /no tiene responsable/.test(r.cuerpo?.error ?? ""), r);
    r = await iniciar(o1.id, "TECHNICIAN", { motivo: "Urgente, no hay nadie" });
    revisar("técnico con motivo (excepción que no le toca) → 422", r.status === 422, r);
    r = await iniciar(o1.id, "SUPERVISOR");
    revisar("supervisor sin motivo → 422", r.status === 422, r);
    r = await iniciar(o1.id, "REQUESTER", { tomarla: true });
    revisar("solicitante, aun tomándola → 403 (la ruta ni siquiera la deja pasar)", r.status === 403, r);
    r = await iniciar(o1.id, "VIEWER", { tomarla: true });
    revisar("consulta, aun tomándola → 403", r.status === 403, r);
    const o1d = await orden(o1.id);
    revisar("después de todos los rechazos la orden sigue abierta, sin inicio ni responsable",
      o1d.status === "OPEN" && o1d.startedAt === null && o1d.assignedToId === null, { status: o1d.status });

    console.log("\n2. La ruta permite tomarla o la excepción controlada");
    const o2 = await nuevaOt();
    r = await iniciar(o2.id, "TECHNICIAN", { tomarla: true });
    const o2d = await orden(o2.id);
    revisar("técnico que la toma → 200 y queda como responsable", r.status === 200 && o2d.status === "IN_PROGRESS" && o2d.assignedToId === usuarios.TECHNICIAN.id, r.status);

    const o3 = await nuevaOt();
    r = await iniciar(o3.id, "SUPERVISOR", { motivo: "Arranque de emergencia en turno nocturno" });
    const o3d = await orden(o3.id);
    const log = await prisma.auditLog.findFirst({ where: { entityId: o3.id, action: "STATUS_CHANGED" } });
    revisar("supervisor con motivo → 200, inicia SIN responsable", r.status === 200 && o3d.status === "IN_PROGRESS" && o3d.assignedToId === null, r.status);
    revisar("la excepción queda en auditoría con quién y por qué",
      !!log && log.userId === usuarios.SUPERVISOR.id && JSON.parse(log.changes).iniciadaSinResponsable === true &&
      JSON.parse(log.changes).motivo === "Arranque de emergencia en turno nocturno");
    revisar("y en la bitácora de la orden", o3d.comments.some((c) => c.body === "Iniciada sin responsable: Arranque de emergencia en turno nocturno"));

    const o4 = await nuevaOt();
    await Promise.all([iniciar(o4.id, "TECHNICIAN", { tomarla: true }), iniciar(o4.id, "TECHNICIAN", { tomarla: true })]);
    revisar("doble clic al tomarla: una sola transición",
      (await prisma.auditLog.count({ where: { entityId: o4.id, action: "STATUS_CHANGED" } })) === 1);

    console.log("\n3. La pantalla de la orden lo dice antes del clic");
    const pagina = async (id: string, rol: string) =>
      (await fetch(`${base}/work-orders/${id}`, { headers: { Cookie: usuarios[rol].cookie }, signal: AbortSignal.timeout(120_000) })).text();
    const o5 = await nuevaOt();
    const htmlTec = await pagina(o5.id, "TECHNICIAN");
    revisar("técnico: aviso «Sin responsable», botón «Tomar e iniciar» y sin mención de excepción",
      htmlTec.includes("Sin responsable") && htmlTec.includes("Tomar e iniciar") && htmlTec.includes("solo lo autoriza un supervisor"));
    const htmlSup = await pagina(o5.id, "SUPERVISOR");
    revisar("supervisor: el aviso menciona la excepción con motivo",
      htmlSup.includes("Tomar e iniciar") && htmlSup.includes("solo como excepción puede iniciarla sin responsable"));
    const htmlSol = await pagina(o5.id, "REQUESTER");
    revisar("solicitante: aviso de que su rol no puede iniciarla y sin botón",
      htmlSol.includes("Su rol no puede iniciarla") && !htmlSol.includes("Tomar e iniciar"));
    const htmlExc = await pagina(o3.id, "ADMIN");
    revisar("orden iniciada por excepción: «En curso sin responsable» con el motivo a la vista",
      htmlExc.includes("En curso sin responsable") && htmlExc.includes("Arranque de emergencia en turno nocturno"));

    console.log("\n4. Aislamiento");
    const ajena = await prisma.organization.create({ data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE", status: "ACTIVE" } });
    try {
      const oAjena = await prisma.workOrder.create({ data: { organizationId: ajena.id, number: "OT-X1", title: "Ajena", status: "OPEN" } });
      r = await iniciar(oAjena.id, "ADMIN", { tomarla: true });
      revisar("una orden de otra empresa → 404 y no cambia", r.status === 404 && (await prisma.workOrder.findUniqueOrThrow({ where: { id: oAjena.id } })).status === "OPEN", r);
    } finally {
      await prisma.organization.delete({ where: { id: ajena.id } });
    }
  } finally {
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    if (servidor?.pid) {
      await apagarServidor(servidor, 3197);
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
