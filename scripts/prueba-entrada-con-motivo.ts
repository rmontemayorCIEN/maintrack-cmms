/**
 * Una entrada al almacen tiene que decir de donde viene.
 *
 * Medido en produccion antes de esto: salidas, traspasos y devoluciones
 * llevaban su documento el 100% de las veces; las entradas, el 15%. Y entre
 * las sueltas habia cinco que decian «Compra de reposicion» —material que SI
 * venia de una compra y entro sin quedar ligado a ella—.
 *
 * Lo que eso rompe no se ve el dia que pasa: el kardex dice «compra de
 * reposicion» y no se puede volver a la orden de compra, el costo promedio
 * ponderado se mueve con un costo capturado a mano y sin respaldo, y ese
 * numero termina en el costo de cada orden de trabajo.
 *
 * Aqui se cuida que la regla exista DONDE IMPORTA —en la ruta, no solo en la
 * pantalla—, porque por ahi entran tambien la API publica y las
 * integraciones; y que no se haya vuelto un estorbo para lo que ya estaba
 * bien: salidas y ajustes siguen de un toque.
 *
 *   npx tsx scripts/prueba-entrada-con-motivo.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { SignJWT } from "jose";
import { prisma } from "../lib/db";
import { apagarServidor } from "./apagar-servidor";

const PUERTO = 3195;
const base = process.env.BASE_URL ?? `http://127.0.0.1:${PUERTO}`;

let fallas = 0;
function revisar(que: string, bien: boolean, detalle: unknown = "") {
  const d = typeof detalle === "string" ? detalle : JSON.stringify(detalle);
  console.log(`  ${bien ? "ok  " : "FALLA"} ${que}${d ? ` · ${d}` : ""}`);
  if (!bien) fallas++;
}

async function esperarServidor(limiteMs = 120_000) {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    try {
      const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(8000) });
      if (r.status < 500) return;
    } catch { /* todavia no */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

async function main() {
  let servidor: ChildProcess | null = null;
  if (!process.env.BASE_URL) {
    servidor = spawn("npx", ["next", "dev", "-p", String(PUERTO), "-H", "127.0.0.1"], { stdio: "ignore", detached: true });
  }

  const sello = `mot-${Date.now()}`;
  const creadas: string[] = [];

  try {
    const org = await prisma.organization.create({
      data: { name: sello, slug: sello, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(org.id);
    const alm = await prisma.warehouse.create({ data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true } });
    const parte = await prisma.part.create({
      data: { organizationId: org.id, code: "BND-1", name: "Banda", unit: "pza", unitCost: 100, minQuantity: 2, maxQuantity: 10 },
    });
    const jefe = await prisma.user.create({
      data: { organizationId: org.id, email: `j-${sello}@t.mx`, name: "Jefa", role: "ADMIN", passwordHash: "x" },
    });

    await esperarServidor();
    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const jwt = await new SignJWT({ userId: jefe.id, organizationId: org.id, email: jefe.email, name: jefe.name, role: jefe.role })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secreto);

    const mover = async (cuerpo: Record<string, unknown>) => {
      const r = await fetch(`${base}/api/parts/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `mt_session=${jwt}` },
        body: JSON.stringify({ partId: parte.id, warehouseId: alm.id, ...cuerpo }),
      });
      return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
    };

    console.log("\nLa entrada tiene que decir de dónde viene\n");
    const sinMotivo = await mover({ movementType: "IN", quantity: 3 });
    revisar("una entrada sin motivo se rechaza", sinMotivo.status === 422, { status: sinMotivo.status });
    revisar("y el mensaje dice qué hacer, no solo que está mal",
      String(sinMotivo.json.error ?? "").includes("recíbalo en la compra"), sinMotivo.json.error);

    const vacio = await mover({ movementType: "IN", quantity: 3, reference: "   " });
    revisar("un motivo en blanco tampoco cuenta", vacio.status === 422, { status: vacio.status });
    const corto = await mover({ movementType: "IN", quantity: 3, reference: "x" });
    revisar("ni una letra suelta, que dentro de seis meses no dice nada", corto.status === 422, { status: corto.status });

    const conMotivo = await mover({ movementType: "IN", quantity: 3, reference: "Sobrante del proyecto de la línea 2" });
    revisar("con motivo entra", conMotivo.status === 201, { status: conMotivo.status, saldo: conMotivo.json.balance });

    console.log("\nLo que ya estaba bien no se estorba\n");
    const salida = await mover({ movementType: "OUT", quantity: 1 });
    revisar("una salida sigue de un toque, sin motivo", salida.status === 201, { status: salida.status });
    const ajuste = await mover({ movementType: "ADJUST", quantity: 5 });
    revisar("un ajuste también", ajuste.status === 201, { status: ajuste.status });
    const devolucion = await mover({ movementType: "RETURN", quantity: 1 });
    revisar("y una devolución también", devolucion.status === 201, { status: devolucion.status });

    console.log("\nLo que queda escrito en el kardex\n");
    const movs = await prisma.stockMovement.findMany({
      where: { organizationId: org.id },
      select: { movementType: true, reference: true, quantity: true },
      orderBy: { createdAt: "asc" },
    });
    const entrada = movs.find((m) => m.movementType === "IN");
    revisar("la entrada guarda el motivo tal cual se escribió",
      entrada?.reference === "Sobrante del proyecto de la línea 2", entrada?.reference);
    revisar("no se coló ninguna entrada sin motivo",
      movs.filter((m) => m.movementType === "IN").every((m) => (m.reference ?? "").trim().length >= 4),
      movs.filter((m) => m.movementType === "IN").map((m) => m.reference));

    console.log("\nLo que NO debe pasar\n");
    revisar("la regla vive en la ruta, no solo en la pantalla: por aquí entra también la API",
      sinMotivo.status === 422);
    const otra = await prisma.organization.create({
      data: { name: `${sello}-b`, slug: `${sello}-b`, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey" },
    });
    creadas.push(otra.id);
    const ajena = await prisma.part.create({ data: { organizationId: otra.id, code: "AJ-1", name: "Ajena", unit: "pza" } });
    const cruzada = await fetch(`${base}/api/parts/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `mt_session=${jwt}` },
      body: JSON.stringify({ partId: ajena.id, warehouseId: alm.id, movementType: "IN", quantity: 1, reference: "Con motivo y todo" }),
    });
    // 4xx, NO 5xx: un 500 tambien "falla", pero es una excepcion sin atender
    // que no le dice nada a quien la recibe. Aceptar cualquier >= 400 se
    // tragaba esa diferencia.
    revisar("con motivo y todo, no se toca el almacén de otra empresa, y se explica",
      cruzada.status >= 400 && cruzada.status < 500, { status: cruzada.status });
  } finally {
    for (const id of creadas) {
      await prisma.stockMovement.deleteMany({ where: { organizationId: id } });
      await prisma.partStock.deleteMany({ where: { organizationId: id } });
      await prisma.part.deleteMany({ where: { organizationId: id } });
      await prisma.warehouse.deleteMany({ where: { organizationId: id } });
      await prisma.user.deleteMany({ where: { organizationId: id } });
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
    await apagarServidor(servidor, PUERTO);
  }

  console.log(`\n${fallas ? `${fallas} revisión(es) fallaron` : "Todo bien"}\n`);
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
