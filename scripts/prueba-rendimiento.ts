/**
 * Cuanto tarda cada pantalla pesada con el volumen de un piloto.
 *
 * Mide las MISMAS funciones que llaman las pantallas, no una imitacion. Lo
 * que se cronometra es el trabajo de servidor: consultas y calculo. Lo que
 * tarde el navegador en dibujar va aparte (scripts/prueba-responsiva.ts).
 *
 *   npx tsx scripts/sembrar-volumen.ts     # una vez
 *   npx tsx scripts/prueba-rendimiento.ts
 *
 * ── Que NO dice esta prueba ──
 *
 * Corre contra SQLite, que es lo que hay en desarrollo. Eso basta para ver
 * los problemas de FORMA —traer veinte mil renglones a memoria, sumar en
 * JavaScript lo que la base sabe sumar, una consulta por cada fila— que son
 * los que mandan y no dependen del motor. Lo que NO puede decir es si un
 * indice concreto se usa en PostgreSQL: eso solo se sabe midiendo alla.
 */
import { prisma } from "../lib/db";
import { SLUG_VOLUMEN } from "./sembrar-volumen";

/** Lo que una persona aguanta sin sentir que el sistema se trabo. */
const LIMITE_MS = 1_500;

let fallas = 0;
const resultados: Array<{ que: string; ms: number; filas?: number }> = [];

async function medir(que: string, fn: () => Promise<unknown>, limite = LIMITE_MS) {
  // Una pasada en frio y dos medidas: la primera incluye el arranque de
  // Prisma y no representa nada.
  await fn().catch(() => undefined);
  const tiempos: number[] = [];
  for (let i = 0; i < 2; i++) {
    const t = Date.now();
    await fn();
    tiempos.push(Date.now() - t);
  }
  const ms = Math.min(...tiempos);
  const bien = ms <= limite;
  if (!bien) fallas++;
  resultados.push({ que, ms });
  console.log(`  ${bien ? "ok   " : "LENTO"} ${que.padEnd(52)} ${String(ms).padStart(6)} ms   (límite ${limite})`);
}

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: SLUG_VOLUMEN } });
  if (!org) {
    console.log("\nNo existe la empresa de volumen. Cree primero:\n  npx tsx scripts/sembrar-volumen.ts\n");
    process.exit(1);
  }
  const o = org.id;
  const [dueno, tecnico, admin] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { organizationId: o, role: "OWNER" } }),
    prisma.user.findFirstOrThrow({ where: { organizationId: o, role: "TECHNICIAN" } }),
    prisma.user.findFirstOrThrow({ where: { organizationId: o, role: "ADMIN" } }),
  ]);
  const activo = await prisma.asset.findFirstOrThrow({ where: { organizationId: o } });

  const [{ inicioDe }, { calcularIndicadores }, { buscar }, { indicadoresDeAlmacen }, { revisarCalidad }, { costoDeParar }, { periodoIndicadores }] =
    await Promise.all([
      import("../lib/inicio"), import("../lib/indicadores"), import("../lib/busqueda"),
      import("../lib/indicadores-almacen"), import("../lib/calidad-datos"), import("../lib/costo-de-parar"),
      import("../lib/periodos"),
    ]);
  const periodo = periodoIndicadores(90, org.timezone);

  const cuantos = await Promise.all([
    prisma.workOrder.count({ where: { organizationId: o } }),
    prisma.stockMovement.count({ where: { organizationId: o } }),
    prisma.meterReading.count({ where: { organizationId: o } }),
  ]);
  console.log(`\nEmpresa de volumen: ${cuantos[0].toLocaleString("es-MX")} órdenes · ${cuantos[1].toLocaleString("es-MX")} movimientos · ${cuantos[2].toLocaleString("es-MX")} lecturas\n`);

  console.log("Inicio, por rol");
  await medir("inicio de la dirección", () => inicioDe({ ...dueno, organization: org } as never));
  await medir("inicio del administrador", () => inicioDe({ ...admin, organization: org } as never));
  await medir("inicio del técnico", () => inicioDe({ ...tecnico, organization: org } as never));

  console.log("\nAnálisis");
  await medir("indicadores (90 días)", () => calcularIndicadores(o, periodo));
  await medir("indicadores de almacén (90 días)", () => indicadoresDeAlmacen(o, periodo.desde, periodo.hasta));
  await medir("dónde para la planta (90 días)", () => costoDeParar(o, { desde: periodo.desde, hasta: periodo.hasta }));
  await medir("calidad de datos", () => revisarCalidad(o));

  console.log("\nBúsqueda");
  await medir("buscar «bomba»", () => buscar({ id: dueno.id, role: dueno.role, isSuperAdmin: false, organizationId: o }, "bomba"));
  await medir("buscar «OT-0001»", () => buscar({ id: dueno.id, role: dueno.role, isSuperAdmin: false, organizationId: o }, "OT-0001"));

  console.log("\nListas (lo que consulta cada pantalla)");
  await medir("órdenes de trabajo (200)", () => prisma.workOrder.findMany({
    where: { organizationId: o }, orderBy: [{ status: "asc" }, { dueDate: "asc" }], take: 200,
    include: { asset: { select: { code: true, name: true } }, assignedTo: { select: { name: true } }, createdBy: { select: { name: true } }, plan: { select: { name: true } } },
  }));
  await medir("órdenes vencidas", async () => {
    const { filtroDeVencidas } = await import("../lib/vencimiento");
    return prisma.workOrder.count({ where: { organizationId: o, ...filtroDeVencidas("America/Monterrey") } });
  });
  await medir("almacén (300)", () => prisma.part.findMany({
    where: { organizationId: o, active: true }, orderBy: { code: "asc" }, take: 300,
    include: { supplier: { select: { name: true } } },
  }));
  await medir("kardex (1000)", () => prisma.stockMovement.findMany({
    where: { organizationId: o }, orderBy: { createdAt: "desc" }, take: 1000,
    include: { part: { select: { code: true, name: true } } },
  }));
  await medir("expediente del activo", () => Promise.all([
    prisma.workOrder.findMany({ where: { assetId: activo.id }, orderBy: { createdAt: "desc" }, take: 25 }),
    prisma.workOrder.aggregate({ where: { assetId: activo.id, status: { not: "CANCELLED" } }, _sum: { totalCost: true }, _count: true }),
    prisma.downtimeEvent.aggregate({ where: { assetId: activo.id }, _sum: { minutes: true } }),
  ]));
  await medir("bitácora (200)", () => prisma.auditLog.findMany({
    where: { organizationId: o }, orderBy: { createdAt: "desc" }, take: 200,
    include: { user: { select: { name: true } } },
  }));

  const peor = [...resultados].sort((a, b) => b.ms - a.ms).slice(0, 3);
  console.log(`\nLo más lento: ${peor.map((p) => `${p.que} (${p.ms} ms)`).join(" · ")}`);
  console.log(fallas ? `\n${fallas} pantalla(s) por encima del límite\n` : "\nTodo dentro del límite\n");
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
