/**
 * Prueba de la liberacion de actividades y del backlog.
 *
 * Lo que se cuida aqui: que una OT no pueda completarse dejando trabajo en el
 * aire, que lo liberado no se pierda, y que la cadena de retomas diga la
 * verdad. Un backlog que miente es peor que no tenerlo: la gente confia en el.
 */
import { PrismaClient } from "@prisma/client";
import { backlog, vecesLiberada } from "../lib/backlog";
import { transitionWorkOrder } from "../lib/workorders";

const prisma = new PrismaClient();
let fallas = 0;

function revisar(etiqueta: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${etiqueta.padEnd(54)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

async function seRechaza(etiqueta: string, fn: () => Promise<unknown>, fragmento: string) {
  try {
    await fn();
    fallas++;
    console.log(`  FALLA ${etiqueta.padEnd(54)} no se rechazo`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const bien = msg.toLowerCase().includes(fragmento.toLowerCase());
    if (!bien) fallas++;
    console.log(`  ${bien ? "ok   " : "FALLA"} ${etiqueta.padEnd(54)} ${bien ? "rechazado" : `mensaje inesperado: ${msg}`}`);
  }
}

async function main() {
  const sufijo = Date.now();
  const org = await prisma.organization.create({ data: { name: "Prueba backlog", slug: `pb-${sufijo}` } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `t-${sufijo}@x.mx`, name: "Tecnico", passwordHash: "x", role: "TECHNICIAN" },
  });
  const site = await prisma.site.create({
    data: { organizationId: org.id, code: "P1", name: "Planta 1" },
  });
  const asset = await prisma.asset.create({
    data: { organizationId: org.id, siteId: site.id, code: "BOM-001", name: "Bomba" },
  });
  const balero = await prisma.part.create({
    data: { organizationId: org.id, code: "BAL-9", name: "Balero 6205", unit: "pza", quantityOnHand: 0 },
  });

  const nuevaOt = async (numero: string, titulos: string[]) =>
    prisma.workOrder.create({
      data: {
        organizationId: org.id, number: numero, title: `Trabajo ${numero}`,
        assetId: asset.id, status: "IN_PROGRESS", maintenanceType: "PREVENTIVE",
        tasks: { create: titulos.map((t, i) => ({ position: i, title: t, origen: "PLAN", maintenanceType: "PREVENTIVE" })) },
      },
      include: { tasks: { orderBy: { position: "asc" } } },
    });

  const cerrar = (id: string) =>
    transitionWorkOrder({ workOrderId: id, to: "COMPLETED", userId: user.id, organizationId: org.id });

  console.log("\nLA OT NO SE COMPLETA CON TRABAJO EN EL AIRE\n");

  const ot1 = await nuevaOt("OT-1", ["Cambiar balero", "Lubricar", "Revisar vibracion"]);
  await seRechaza("3 actividades abiertas", () => cerrar(ot1.id), "sin resolver");

  await prisma.workOrderTask.update({ where: { id: ot1.tasks[1].id }, data: { done: true } });
  await prisma.workOrderTask.update({ where: { id: ot1.tasks[2].id }, data: { done: true } });
  await seRechaza("queda 1 abierta", () => cerrar(ot1.id), "sin resolver");

  // La que falta se libera: no habia balero.
  await prisma.workOrderTask.update({
    where: { id: ot1.tasks[0].id },
    data: {
      liberadaAt: new Date(), liberadaPorId: user.id,
      motivoLiberacion: "SIN_REFACCION", bloqueadaPorPartId: balero.id,
    },
  });
  const cerrada = await cerrar(ot1.id);
  revisar("con la ultima liberada, si completa", cerrada.status, "COMPLETED");

  console.log("\nLO LIBERADO NO SE PIERDE\n");

  const b1 = await backlog(org.id);
  revisar("aparece en el backlog", b1.length, 1);
  revisar("conserva su titulo", b1[0]?.title, "Cambiar balero");
  revisar("dice de que OT venia", b1[0]?.workOrder.number, "OT-1");
  revisar("conserva su origen", b1[0]?.origen, "PLAN");
  revisar("dice el motivo", b1[0]?.motivoLiberacion, "SIN_REFACCION");
  revisar("sin existencia: todavia no se puede", b1[0]?.yaSePuede, false);
  revisar("las hechas no entran al backlog", b1.filter((t) => t.title === "Lubricar").length, 0);

  console.log("\nEL BACKLOG MIRA LA EXISTENCIA DE HOY\n");

  await prisma.part.update({ where: { id: balero.id }, data: { quantityOnHand: 4 } });
  const b2 = await backlog(org.id);
  revisar("con existencia: ya se puede", b2[0]?.yaSePuede, true);

  const otraOrg = await prisma.organization.create({ data: { name: "Ajena", slug: `aj-${sufijo}` } });
  revisar("otra organizacion no lo ve", (await backlog(otraOrg.id)).length, 0);
  revisar("filtro por activo funciona", (await backlog(org.id, { assetId: asset.id })).length, 1);

  console.log("\nLA CADENA DE RETOMAS\n");

  const ot2 = await nuevaOt("OT-2", ["Cambiar balero"]);
  await prisma.workOrderTask.update({
    where: { id: ot2.tasks[0].id },
    data: { origen: "BACKLOG", retomaDeTaskId: ot1.tasks[0].id },
  });
  revisar("retomada: sale del backlog", (await backlog(org.id)).length, 0);
  revisar("se libero 1 vez", await vecesLiberada(ot2.tasks[0].id), 1);

  // Se vuelve a trabar.
  await prisma.workOrderTask.update({
    where: { id: ot2.tasks[0].id },
    data: { liberadaAt: new Date(), motivoLiberacion: "SIN_MANO_DE_OBRA" },
  });
  const b3 = await backlog(org.id);
  revisar("vuelve al backlog", b3.length, 1);
  revisar("con el motivo nuevo", b3[0]?.motivoLiberacion, "SIN_MANO_DE_OBRA");
  revisar("y ya van 2 veces", await vecesLiberada(ot2.tasks[0].id), 2);
  revisar("motivo no-refaccion no opina de existencia", b3[0]?.yaSePuede, null);

  console.log("\nUNA SOLA RETOMA POR ACTIVIDAD\n");

  const ot3 = await nuevaOt("OT-3", ["Cambiar balero"]);
  await seRechaza(
    "dos OTs no pueden retomar la misma",
    () => prisma.workOrderTask.update({
      where: { id: ot3.tasks[0].id },
      data: { retomaDeTaskId: ot1.tasks[0].id },
    }),
    "unique",
  );

  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}

main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
