/**
 * Prueba del punto unico de movimientos, contra una base desechable.
 *
 * Verifica lo que un descuadre de inventario cuesta caro: que el saldo por
 * almacen cuadre, que el total de la refaccion sea siempre la suma de sus
 * almacenes, que no se pueda sacar de mas y que un traspaso mueva exactamente
 * lo mismo que quita.
 */
import { PrismaClient } from "@prisma/client";
import { ErrorDeAlmacen, aplicarMovimiento, traspasar } from "../lib/almacen";

const prisma = new PrismaClient();
let fallas = 0;

function revisar(etiqueta: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${etiqueta.padEnd(52)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

async function saldos(partId: string) {
  const [stocks, part] = await Promise.all([
    prisma.partStock.findMany({ where: { partId }, select: { warehouseId: true, quantity: true } }),
    prisma.part.findUnique({ where: { id: partId }, select: { quantityOnHand: true, unitCost: true } }),
  ]);
  return { stocks, total: part!.quantityOnHand, costo: part!.unitCost };
}

async function main() {
  const org = await prisma.organization.create({ data: { name: "Prueba", slug: `prueba-${Date.now()}` } });
  const [general, linea] = await Promise.all([
    prisma.warehouse.create({ data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true } }),
    prisma.warehouse.create({ data: { organizationId: org.id, code: "L1", name: "Linea 1" } }),
  ]);
  const part = await prisma.part.create({
    data: { organizationId: org.id, code: "BAL-001", name: "Balero", unit: "pza", unitCost: 100 },
  });
  const base = { organizationId: org.id, partId: part.id };

  console.log("\nMOVIMIENTOS\n");

  await aplicarMovimiento({ ...base, warehouseId: general.id, tipo: "IN", cantidad: 10, costoUnitario: 100 });
  revisar("entrada de 10 al general", (await saldos(part.id)).total, 10);

  // Costo promedio ponderado: 10 a $100 mas 10 a $200 debe dar $150.
  await aplicarMovimiento({ ...base, warehouseId: general.id, tipo: "IN", cantidad: 10, costoUnitario: 200 });
  revisar("costo promedio tras entrada mas cara", (await saldos(part.id)).costo, 150);

  await aplicarMovimiento({ ...base, warehouseId: general.id, tipo: "OUT", cantidad: 4 });
  revisar("salida de 4", (await saldos(part.id)).total, 16);

  // Una salida no debe alterar el costo de lo que ya estaba.
  revisar("la salida no movio el costo", (await saldos(part.id)).costo, 150);

  await aplicarMovimiento({ ...base, warehouseId: general.id, tipo: "RETURN", cantidad: 1 });
  revisar("devolucion de 1 suma", (await saldos(part.id)).total, 17);

  let rechazo = "";
  try {
    await aplicarMovimiento({ ...base, warehouseId: general.id, tipo: "OUT", cantidad: 999 });
  } catch (e) {
    rechazo = e instanceof ErrorDeAlmacen ? "rechazado" : "error equivocado";
  }
  revisar("sacar mas de lo que hay se rechaza", rechazo, "rechazado");
  revisar("el rechazo no dejo el saldo tocado", (await saldos(part.id)).total, 17);

  // Sacar de un almacen donde no hay nada tampoco debe pasar.
  rechazo = "";
  try {
    await aplicarMovimiento({ ...base, warehouseId: linea.id, tipo: "OUT", cantidad: 1 });
  } catch (e) {
    rechazo = e instanceof ErrorDeAlmacen ? "rechazado" : "error equivocado";
  }
  revisar("sacar de un almacen vacio se rechaza", rechazo, "rechazado");

  console.log("\nTRASPASO\n");

  await traspasar({
    organizationId: org.id, folio: "TR-000001",
    origenId: general.id, destinoId: linea.id,
    renglones: [{ partId: part.id, cantidad: 5 }],
  });

  const s = await saldos(part.id);
  const enGeneral = s.stocks.find((x) => x.warehouseId === general.id)?.quantity ?? 0;
  const enLinea = s.stocks.find((x) => x.warehouseId === linea.id)?.quantity ?? 0;
  revisar("el origen bajo 5", enGeneral, 12);
  revisar("el destino subio 5", enLinea, 5);
  revisar("el traspaso no creo ni destruyo existencia", enGeneral + enLinea, 17);
  revisar("el total de la refaccion es la suma de almacenes", s.total, enGeneral + enLinea);

  // Un traspaso que no cabe no debe dejar rastro: ni el documento ni medio
  // movimiento. Es lo que separa una transaccion de dos escrituras seguidas.
  const antes = await prisma.stockTransfer.count({ where: { organizationId: org.id } });
  rechazo = "";
  try {
    await traspasar({
      organizationId: org.id, folio: "TR-000002",
      origenId: linea.id, destinoId: general.id,
      renglones: [{ partId: part.id, cantidad: 9999 }],
    });
  } catch (e) {
    rechazo = e instanceof ErrorDeAlmacen ? "rechazado" : "error equivocado";
  }
  revisar("traspaso imposible se rechaza", rechazo, "rechazado");
  revisar("no quedo traspaso a medias", await prisma.stockTransfer.count({ where: { organizationId: org.id } }), antes);
  const t = await saldos(part.id);
  revisar("los saldos quedaron como antes del intento", t.total, 17);

  console.log("\nADJUST\n");
  await aplicarMovimiento({ ...base, warehouseId: linea.id, tipo: "ADJUST", cantidad: 3 });
  const a = await saldos(part.id);
  revisar("el ajuste fija el saldo del almacen", a.stocks.find((x) => x.warehouseId === linea.id)?.quantity, 3);
  revisar("y el total se recalcula solo", a.total, 15);

  console.log("\nKARDEX\n");
  const movs = await prisma.stockMovement.findMany({
    where: { partId: part.id }, orderBy: { createdAt: "asc" },
    select: { movementType: true, warehouseId: true, balanceAfter: true },
  });
  revisar("cada movimiento quedo asentado en un almacen", movs.every((m) => m.warehouseId), true);
  // Siete: dos entradas, una salida, una devolucion, las dos mitades del
  // traspaso y el ajuste. Los tres intentos rechazados no dejan rastro, que es
  // justo lo que se esta comprobando.
  revisar("numero de movimientos", movs.length, 7);
  revisar("tipos asentados", movs.map((m) => m.movementType).join(","),
    "IN,IN,OUT,RETURN,TRANSFER_OUT,TRANSFER_IN,ADJUST");

  await prisma.organization.delete({ where: { id: org.id } });
  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}

main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
