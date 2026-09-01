/**
 * Prueba de la fusion de refacciones duplicadas.
 *
 * Es la operacion que no se puede deshacer, asi que lo que se verifica es que
 * NADA se pierda: ni existencia, ni kardex, ni consumos en ordenes, ni
 * renglones de requisicion. Y que lo que no debe fusionarse, no se fusione.
 */
import { PrismaClient } from "@prisma/client";
import { ErrorDeFusion, fusionarRefacciones } from "../lib/dedupe-refacciones";

const prisma = new PrismaClient();
let fallas = 0;
function revisar(e: string, real: unknown, esp: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esp);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(56)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esp)})`}`);
}
async function intentar(fn: () => Promise<unknown>) {
  try { await fn(); return "paso"; } catch (e) { return e instanceof ErrorDeFusion ? "rechazado" : `error: ${(e as Error).message}`; }
}

async function main() {
  const org = await prisma.organization.create({ data: { name: "Prueba fusion", slug: `fu-${Date.now()}` } });
  const user = await prisma.user.create({ data: { organizationId: org.id, email: `f${Date.now()}@x.com`, name: "Almacen", passwordHash: "x", role: "ADMIN" } });
  const [gen, linea] = await Promise.all([
    prisma.warehouse.create({ data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true } }),
    prisma.warehouse.create({ data: { organizationId: org.id, code: "L1", name: "Linea" } }),
  ]);
  const site = await prisma.site.create({ data: { organizationId: org.id, code: "S", name: "Planta" } });
  const wo = await prisma.workOrder.create({ data: { organizationId: org.id, number: "OT-1", title: "Repar", siteId: site.id } });

  // Tres registros de la misma pieza, repartidos entre dos almacenes.
  const a = await prisma.part.create({ data: { organizationId: org.id, code: "BAL-6205", name: "Balero 6205", unit: "pza", unitCost: 100, quantityOnHand: 10 } });
  const b = await prisma.part.create({ data: { organizationId: org.id, code: "BALERO6205", name: "BALERO 6205 2RS", unit: "pza", unitCost: 200, quantityOnHand: 6 } });
  const c = await prisma.part.create({ data: { organizationId: org.id, code: "B-6205-SKF", name: "balero 6205-2rs skf", unit: "pza", unitCost: 150, quantityOnHand: 4 } });
  const metros = await prisma.part.create({ data: { organizationId: org.id, code: "MAN", name: "Manguera 6205", unit: "m", unitCost: 50, quantityOnHand: 3 } });

  await prisma.partStock.createMany({
    data: [
      { organizationId: org.id, partId: a.id, warehouseId: gen.id, quantity: 10, bin: "P1-R1" },
      { organizationId: org.id, partId: b.id, warehouseId: gen.id, quantity: 4 },
      { organizationId: org.id, partId: b.id, warehouseId: linea.id, quantity: 2 },
      { organizationId: org.id, partId: c.id, warehouseId: linea.id, quantity: 4, bin: "P9" },
      { organizationId: org.id, partId: metros.id, warehouseId: gen.id, quantity: 3 },
    ],
  });
  // Historial repartido entre las tres.
  await prisma.stockMovement.createMany({
    data: [
      { organizationId: org.id, partId: a.id, warehouseId: gen.id, movementType: "IN", quantity: 10, balanceAfter: 10 },
      { organizationId: org.id, partId: b.id, warehouseId: gen.id, movementType: "IN", quantity: 4, balanceAfter: 4 },
      { organizationId: org.id, partId: b.id, warehouseId: linea.id, movementType: "IN", quantity: 2, balanceAfter: 2 },
      { organizationId: org.id, partId: c.id, warehouseId: linea.id, movementType: "IN", quantity: 4, balanceAfter: 4 },
    ],
  });
  await prisma.workOrderPart.createMany({
    data: [
      { workOrderId: wo.id, partId: a.id, quantity: 1, unitCost: 100, cost: 100 },
      { workOrderId: wo.id, partId: c.id, quantity: 2, unitCost: 150, cost: 300 },
    ],
  });

  console.log("\nLO QUE NO SE DEBE FUSIONAR\n");
  revisar("no se fusionan piezas con distinta unidad",
    await intentar(() => fusionarRefacciones({ organizationId: org.id, userId: user.id, sobrevivienteId: a.id, absorbidasIds: [metros.id] })),
    "rechazado");
  revisar("el intento fallido no toco nada",
    (await prisma.part.findUnique({ where: { id: metros.id }, select: { quantityOnHand: true } }))!.quantityOnHand, 3);

  const otraOrg = await prisma.organization.create({ data: { name: "Ajena", slug: `aj-${Date.now()}` } });
  const ajena = await prisma.part.create({ data: { organizationId: otraOrg.id, code: "X", name: "Balero 6205", unit: "pza" } });
  revisar("no se fusiona con una refaccion de otra empresa",
    await intentar(() => fusionarRefacciones({ organizationId: org.id, userId: user.id, sobrevivienteId: a.id, absorbidasIds: [ajena.id] })),
    "rechazado");

  console.log("\nLA FUSION\n");
  const r = await fusionarRefacciones({
    organizationId: org.id, userId: user.id, sobrevivienteId: a.id, absorbidasIds: [b.id, c.id],
  });
  revisar("sobrevive la elegida", r.sobreviviente.code, "BAL-6205");
  revisar("absorbio dos", r.absorbidas.length, 2);

  const stocks = await prisma.partStock.findMany({ where: { partId: a.id }, select: { warehouseId: true, quantity: true, bin: true } });
  const enGen = stocks.find((s) => s.warehouseId === gen.id);
  const enLinea = stocks.find((s) => s.warehouseId === linea.id);
  revisar("el general suma 10 + 4", enGen?.quantity, 14);
  revisar("la linea suma 2 + 4", enLinea?.quantity, 6);
  revisar("conserva la ubicacion que ya tenia", enGen?.bin, "P1-R1");
  revisar("hereda la ubicacion donde no tenia", enLinea?.bin, "P9");
  revisar("el total es la suma de todo", r.sobreviviente.quantityOnHand, 20);

  // 10 a 100, 6 a 200 y 4 a 150 = (1000 + 1200 + 600) / 20 = 140
  revisar("el costo queda ponderado por existencia", r.sobreviviente.unitCost, 140);

  console.log("\nNADA SE PERDIO\n");
  revisar("todo el kardex quedo bajo la sobreviviente",
    await prisma.stockMovement.count({ where: { partId: a.id } }), 4);
  revisar("ningun movimiento quedo huerfano",
    await prisma.stockMovement.count({ where: { organizationId: org.id, partId: { in: [b.id, c.id] } } }), 0);
  revisar("los consumos en la orden se conservaron",
    await prisma.workOrderPart.count({ where: { partId: a.id } }), 2);
  revisar("las absorbidas ya no existen",
    await prisma.part.count({ where: { id: { in: [b.id, c.id] } } }), 0);
  revisar("la de otra empresa sigue intacta",
    await prisma.part.count({ where: { id: ajena.id } }), 1);

  for (const o of [org, otraOrg]) {
    await prisma.$transaction([
      prisma.stockMovement.deleteMany({ where: { organizationId: o.id } }),
      prisma.workOrderPart.deleteMany({ where: { workOrder: { organizationId: o.id } } }),
      prisma.workOrder.deleteMany({ where: { organizationId: o.id } }),
      prisma.partStock.deleteMany({ where: { organizationId: o.id } }),
      prisma.part.deleteMany({ where: { organizationId: o.id } }),
      prisma.warehouse.deleteMany({ where: { organizationId: o.id } }),
      prisma.site.deleteMany({ where: { organizationId: o.id } }),
      prisma.user.deleteMany({ where: { organizationId: o.id } }),
      prisma.organization.delete({ where: { id: o.id } }),
    ]);
  }
  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
