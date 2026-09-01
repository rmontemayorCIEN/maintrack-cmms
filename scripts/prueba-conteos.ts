/**
 * Prueba del conteo ciclico. Lo que importa: que la diferencia se mida contra
 * la foto de apertura, que el ajuste se aplique contra lo que hay al cerrar, y
 * que un movimiento legitimo durante el conteo no se borre en silencio.
 */
import { PrismaClient } from "@prisma/client";
import { aplicarMovimiento } from "../lib/almacen";
import { ErrorDeConteo, abrirConteo, capturarConteo, cerrarConteo, exactitud } from "../lib/conteos";

const prisma = new PrismaClient();
let fallas = 0;
function revisar(e: string, real: unknown, esp: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(54)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esp)})`}`);
}
async function intentar(fn: () => Promise<unknown>) {
  try { await fn(); return "paso"; } catch (e) { return e instanceof ErrorDeConteo ? "rechazado" : `error: ${(e as Error).message}`; }
}

async function main() {
  const org = await prisma.organization.create({ data: { name: "Prueba CI", slug: `ci-${Date.now()}` } });
  const alm = await prisma.warehouse.create({ data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true } });
  const user = await prisma.user.create({ data: { organizationId: org.id, email: `c${Date.now()}@x.com`, name: "Almacen", passwordHash: "x", role: "TECHNICIAN" } });

  const partes = await Promise.all([
    prisma.part.create({ data: { organizationId: org.id, code: "A", name: "Cuadra", unit: "pza", unitCost: 10, quantityOnHand: 10 } }),
    prisma.part.create({ data: { organizationId: org.id, code: "B", name: "Sobra", unit: "pza", unitCost: 20, quantityOnHand: 5 } }),
    prisma.part.create({ data: { organizationId: org.id, code: "C", name: "Falta", unit: "pza", unitCost: 30, quantityOnHand: 8 } }),
    prisma.part.create({ data: { organizationId: org.id, code: "D", name: "Se movio", unit: "pza", unitCost: 40, quantityOnHand: 12 } }),
  ]);
  await prisma.partStock.createMany({
    data: partes.map((p, i) => ({ organizationId: org.id, partId: p.id, warehouseId: alm.id, quantity: [10, 5, 8, 12][i] })),
  });
  const saldo = async (partId: string) =>
    (await prisma.partStock.findFirst({ where: { partId }, select: { quantity: true } }))!.quantity;

  console.log("\nAPERTURA\n");
  const c = await abrirConteo({ organizationId: org.id, warehouseId: alm.id, userId: user.id });
  revisar("el folio es de la serie CI", c.folio.slice(0, 3), "CI-");
  revisar("tomo foto de las 4 refacciones",
    await prisma.inventoryCountLine.count({ where: { countId: c.id } }), 4);
  revisar("dos conteos abiertos a la vez se rechaza",
    await intentar(() => abrirConteo({ organizationId: org.id, warehouseId: alm.id, userId: user.id })), "rechazado");

  console.log("\nCAPTURA\n");
  const lineas = await prisma.inventoryCountLine.findMany({
    where: { countId: c.id }, include: { part: { select: { code: true } } },
  });
  const de = (code: string) => lineas.find((l) => l.part.code === code)!;

  // Durante el conteo alguien surte 3 de la D: movimiento legitimo.
  await aplicarMovimiento({
    organizationId: org.id, partId: de("D").partId, warehouseId: alm.id,
    tipo: "OUT", cantidad: 3, userId: user.id, referencia: "Salida durante el conteo",
  });
  revisar("la D quedo en 9 por la salida", await saldo(de("D").partId), 9);

  await capturarConteo({
    organizationId: org.id, countId: c.id,
    renglones: [
      { lineId: de("A").id, cantidadContada: 10 },              // cuadra
      { lineId: de("B").id, cantidadContada: 7 },               // sobran 2
      { lineId: de("C").id, cantidadContada: 6, nota: "Faltan 2, se revisa" },
      { lineId: de("D").id, cantidadContada: 9 },               // coincide con lo que hay al cerrar
    ],
  });

  // Antes de cerrar solo existe la foto de apertura: la D aparece como
  // diferencia porque el sistema todavia no sabe que su salida fue legitima.
  const capturadas = await prisma.inventoryCountLine.findMany({ where: { countId: c.id } });
  revisar("exactitud antes de cerrar, contra la foto",
    (() => { const e = exactitud(capturadas)!; return `${e.exactos}/${e.contados}`; })(), "1/4");

  console.log("\nCIERRE\n");
  const r = await cerrarConteo({ organizationId: org.id, countId: c.id, userId: user.id });
  revisar("tres ajustes aplicados", r.ajustados, 2);
  revisar("aviso de una refaccion movida durante el conteo", r.movidosDuranteElConteo, 1);

  revisar("A sigue en 10", await saldo(de("A").partId), 10);
  revisar("B ajustada a 7", await saldo(de("B").partId), 7);
  revisar("C ajustada a 6", await saldo(de("C").partId), 6);
  revisar("D no se ajusto: lo contado ya era lo que habia", await saldo(de("D").partId), 9);

  const ajustes = await prisma.stockMovement.findMany({
    where: { organizationId: org.id, movementType: "ADJUST" }, select: { reference: true },
  });
  revisar("los ajustes quedaron con el folio del conteo",
    ajustes.every((a) => a.reference === `Conteo ${c.folio}`), true);
  revisar("numero de ajustes en el kardex", ajustes.length, 2);

  const cerrado = await prisma.inventoryCount.findUnique({ where: { id: c.id }, select: { estado: true, cerradoEl: true } });
  revisar("queda cerrado con fecha", `${cerrado!.estado}:${cerrado!.cerradoEl !== null}`, "CERRADO:true");
  revisar("capturar sobre uno cerrado se rechaza",
    await intentar(() => capturarConteo({ organizationId: org.id, countId: c.id, renglones: [{ lineId: de("A").id, cantidadContada: 1 }] })),
    "rechazado");

  const dLinea = await prisma.inventoryCountLine.findUnique({ where: { id: de("D").id }, select: { cantidadSistema: true, cantidadAlCerrar: true } });
  // Ya cerrado, la exactitud se mide contra lo que habia al cerrar: la D deja
  // de contar como error porque el almacenista si conto bien.
  const finales = await prisma.inventoryCountLine.findMany({ where: { countId: c.id } });
  revisar("exactitud tras cerrar, sin castigar el movimiento legitimo",
    (() => { const e = exactitud(finales)!; return `${e.exactos}/${e.contados}`; })(), "2/4");

  revisar("la D guarda la foto (12) y lo que habia al cerrar (9)",
    `${dLinea!.cantidadSistema}:${dLinea!.cantidadAlCerrar}`, "12:9");

  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { organizationId: org.id } }),
    prisma.inventoryCountLine.deleteMany({ where: { count: { organizationId: org.id } } }),
    prisma.inventoryCount.deleteMany({ where: { organizationId: org.id } }),
    prisma.partStock.deleteMany({ where: { organizationId: org.id } }),
    prisma.part.deleteMany({ where: { organizationId: org.id } }),
    prisma.warehouse.deleteMany({ where: { organizationId: org.id } }),
    prisma.user.deleteMany({ where: { organizationId: org.id } }),
    prisma.organization.delete({ where: { id: org.id } }),
  ]);
  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
