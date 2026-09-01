/**
 * Prueba del circuito requisicion -> vale -> devolucion, contra una base
 * desechable. Lo que se verifica es lo que cuesta caro si falla: que lo
 * surtido salga del almacen, que lo devuelto regrese, que no se pueda entregar
 * de mas y que el estado siga a los renglones sin que nadie lo capture.
 */
import { PrismaClient } from "@prisma/client";
import { ErrorDeRequisicion, cancelar, cerrar, devolver, surtir } from "../lib/requisiciones";

const prisma = new PrismaClient();
let fallas = 0;

function revisar(etiqueta: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${etiqueta.padEnd(54)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

async function intentar(fn: () => Promise<unknown>) {
  try { await fn(); return "paso"; }
  catch (e) { return e instanceof ErrorDeRequisicion ? "rechazado" : `error inesperado: ${(e as Error).message}`; }
}

async function main() {
  const org = await prisma.organization.create({ data: { name: "Prueba RM", slug: `rm-${Date.now()}` } });
  const alm = await prisma.warehouse.create({ data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `t${Date.now()}@x.com`, name: "Tecnico", passwordHash: "x", role: "TECHNICIAN" },
  });
  const site = await prisma.site.create({ data: { organizationId: org.id, code: "S1", name: "Planta" } });
  const asset = await prisma.asset.create({ data: { organizationId: org.id, siteId: site.id, code: "ACT-1", name: "Bomba" } });
  const wo = await prisma.workOrder.create({
    data: { organizationId: org.id, number: "OT-000001", title: "Reparacion", assetId: asset.id },
  });
  const balero = await prisma.part.create({
    data: { organizationId: org.id, code: "BAL", name: "Balero", unit: "pza", unitCost: 250 },
  });
  const reten = await prisma.part.create({
    data: { organizationId: org.id, code: "RET", name: "Reten", unit: "pza", unitCost: 80 },
  });
  await prisma.partStock.createMany({
    data: [
      { organizationId: org.id, partId: balero.id, warehouseId: alm.id, quantity: 10 },
      { organizationId: org.id, partId: reten.id, warehouseId: alm.id, quantity: 4 },
    ],
  });
  await prisma.part.update({ where: { id: balero.id }, data: { quantityOnHand: 10 } });
  await prisma.part.update({ where: { id: reten.id }, data: { quantityOnHand: 4 } });

  const req = await prisma.materialRequest.create({
    data: {
      organizationId: org.id, folio: "RM-000001", warehouseId: alm.id,
      workOrderId: wo.id, solicitanteId: user.id, motivo: "CORRECTIVO", urgencia: "ALTA",
      renglones: {
        create: [
          { partId: balero.id, descripcion: "Balero 6205", cantidadSolicitada: 5 },
          { partId: reten.id, descripcion: "Reten de flecha", cantidadSolicitada: 2 },
        ],
      },
    },
    include: { renglones: { orderBy: { descripcion: "asc" } } },
  });
  const [lBalero, lReten] = [req.renglones[0], req.renglones[1]];
  const base = { organizationId: org.id, requestId: req.id, userId: user.id };

  const saldo = async (partId: string) =>
    (await prisma.partStock.findFirst({ where: { partId, warehouseId: alm.id }, select: { quantity: true } }))!.quantity;

  console.log("\nSURTIDO\n");
  revisar("nace solicitada", req.estado, "SOLICITADA");

  await surtir({ ...base, entregadoA: "Juan Perez", renglones: [{ lineId: lBalero.id, cantidad: 3 }] });
  revisar("el almacen bajo 3 baleros", await saldo(balero.id), 7);
  revisar("estado tras surtido parcial",
    (await prisma.materialRequest.findUnique({ where: { id: req.id }, select: { estado: true } }))!.estado, "PARCIAL");
  revisar("se registro el consumo en la OT",
    await prisma.workOrderPart.count({ where: { workOrderId: wo.id } }), 1);
  revisar("el movimiento guarda a quien se entrego",
    (await prisma.stockMovement.findFirst({ where: { materialRequestId: req.id }, select: { entregadoA: true } }))!.entregadoA,
    "Juan Perez");

  revisar("surtir mas de lo pedido se rechaza",
    await intentar(() => surtir({ ...base, entregadoA: "Juan", renglones: [{ lineId: lBalero.id, cantidad: 9 }] })),
    "rechazado");
  revisar("el rechazo no movio el almacen", await saldo(balero.id), 7);

  revisar("surtir sin decir a quien se rechaza",
    await intentar(() => surtir({ ...base, entregadoA: "  ", renglones: [{ lineId: lBalero.id, cantidad: 1 }] })),
    "rechazado");

  await surtir({ ...base, entregadoA: "Juan Perez", renglones: [
    { lineId: lBalero.id, cantidad: 2 }, { lineId: lReten.id, cantidad: 2 },
  ] });
  revisar("estado tras completar", (await prisma.materialRequest.findUnique({ where: { id: req.id }, select: { estado: true } }))!.estado, "SURTIDA");
  revisar("baleros en el almacen", await saldo(balero.id), 5);
  revisar("retenes en el almacen", await saldo(reten.id), 2);

  console.log("\nDEVOLUCION\n");
  await devolver({ ...base, devuelvePor: "Juan Perez", renglones: [{ lineId: lBalero.id, cantidad: 2 }] });
  revisar("los 2 baleros regresaron al almacen", await saldo(balero.id), 7);
  revisar("el renglon registra lo devuelto",
    (await prisma.materialRequestLine.findUnique({ where: { id: lBalero.id }, select: { cantidadDevuelta: true } }))!.cantidadDevuelta, 2);
  revisar("la devolucion se asento como RETURN",
    await prisma.stockMovement.count({ where: { materialRequestId: req.id, movementType: "RETURN" } }), 1);

  revisar("devolver mas de lo que tiene se rechaza",
    await intentar(() => devolver({ ...base, devuelvePor: "Juan", renglones: [{ lineId: lBalero.id, cantidad: 99 }] })),
    "rechazado");
  revisar("el rechazo no movio el almacen", await saldo(balero.id), 7);

  console.log("\nCIERRE\n");
  revisar("cancelar con material ya surtido se rechaza",
    await intentar(() => cancelar(org.id, req.id)), "rechazado");

  await cerrar(org.id, req.id);
  revisar("queda cerrada", (await prisma.materialRequest.findUnique({ where: { id: req.id }, select: { estado: true } }))!.estado, "CERRADA");
  revisar("surtir sobre una cerrada se rechaza",
    await intentar(() => surtir({ ...base, entregadoA: "Juan", renglones: [{ lineId: lReten.id, cantidad: 1 }] })),
    "rechazado");

  console.log("\nCUADRE FINAL\n");
  const p = await prisma.part.findUnique({ where: { id: balero.id }, select: { quantityOnHand: true } });
  revisar("el total de la refaccion sigue la suma de almacenes", p!.quantityOnHand, await saldo(balero.id));
  const movs = await prisma.stockMovement.findMany({ where: { materialRequestId: req.id }, select: { movementType: true } });
  revisar("movimientos del vale", movs.map((m) => m.movementType).sort().join(","), "OUT,OUT,OUT,RETURN");

  // Limpieza de hoja a raiz: varias relaciones son Restrict a proposito —una
  // requisicion no debe poder llevarse el almacen por delante— asi que borrar
  // la organizacion de un tiro no funciona. En la aplicacion no existe borrar
  // organizaciones; se suspenden.
  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { organizationId: org.id } }),
    prisma.workOrderPart.deleteMany({ where: { workOrder: { organizationId: org.id } } }),
    prisma.materialRequestLine.deleteMany({ where: { request: { organizationId: org.id } } }),
    prisma.materialRequest.deleteMany({ where: { organizationId: org.id } }),
    prisma.workOrder.deleteMany({ where: { organizationId: org.id } }),
    prisma.partStock.deleteMany({ where: { organizationId: org.id } }),
    prisma.part.deleteMany({ where: { organizationId: org.id } }),
    prisma.asset.deleteMany({ where: { organizationId: org.id } }),
    prisma.warehouse.deleteMany({ where: { organizationId: org.id } }),
    prisma.site.deleteMany({ where: { organizationId: org.id } }),
    prisma.user.deleteMany({ where: { organizationId: org.id } }),
    prisma.organization.delete({ where: { id: org.id } }),
  ]);
  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}

main().catch((e) => { console.error("\nERROR:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
