/**
 * Prueba de las equivalencias entre refacciones.
 *
 * Lo que se cuida: que el par no se pueda duplicar al reves, que se lea en los
 * dos sentidos, y que el backlog cuente los equivalentes al decir que un
 * trabajo ya se puede hacer. Un almacen que contesta distinto segun por donde
 * se pregunte es peor que uno que no contesta.
 */
import { PrismaClient } from "@prisma/client";
import { ErrorDeEquivalencia, equivalentesDe, hayConQue, parCanonico, quitarEquivalencia, registrarEquivalencia } from "../lib/equivalencias";
import { backlog } from "../lib/backlog";

const prisma = new PrismaClient();
let fallas = 0;

function revisar(e: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(52)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

async function seRechaza(e: string, fn: () => Promise<unknown>, frag: string) {
  try {
    await fn();
    fallas++;
    console.log(`  FALLA ${e.padEnd(52)} no se rechazo`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const bien = msg.toLowerCase().includes(frag.toLowerCase());
    if (!bien) fallas++;
    console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(52)} ${bien ? "rechazado" : msg}`);
  }
}

async function main() {
  const sufijo = Date.now();
  const org = await prisma.organization.create({ data: { name: "Prueba equiv", slug: `pe-${sufijo}` } });
  const otra = await prisma.organization.create({ data: { name: "Ajena", slug: `ae-${sufijo}` } });

  const parte = (code: string, name: string, hay: number, orgId = org.id) =>
    prisma.part.create({ data: { organizationId: orgId, code, name, unit: "pza", quantityOnHand: hay } });

  const skf = await parte("BAL-SKF", "Balero 6205 SKF", 0);
  const nsk = await parte("BAL-NSK", "Balero 6205 NSK", 6);
  const fag = await parte("BAL-FAG", "Balero 6205 FAG", 0);
  const ajena = await parte("BAL-X", "De otra empresa", 99, otra.id);

  console.log("\nEL PAR NO SE DUPLICA\n");
  await registrarEquivalencia({ organizationId: org.id, partId: skf.id, equivalenteId: nsk.id, tipo: "EQUIVALENTE" });
  await seRechaza("el mismo par otra vez",
    () => registrarEquivalencia({ organizationId: org.id, partId: skf.id, equivalenteId: nsk.id, tipo: "EQUIVALENTE" }), "ya estan");
  await seRechaza("el mismo par AL REVES",
    () => registrarEquivalencia({ organizationId: org.id, partId: nsk.id, equivalenteId: skf.id, tipo: "EQUIVALENTE" }), "ya estan");
  await seRechaza("consigo misma",
    () => registrarEquivalencia({ organizationId: org.id, partId: skf.id, equivalenteId: skf.id, tipo: "EQUIVALENTE" }), "si misma");
  await seRechaza("con una de otra organizacion",
    () => registrarEquivalencia({ organizationId: org.id, partId: skf.id, equivalenteId: ajena.id, tipo: "EQUIVALENTE" }), "no existe");

  const [a, b] = parCanonico(skf.id, nsk.id);
  revisar("el orden canonico es estable", parCanonico(nsk.id, skf.id), [a, b]);

  console.log("\nSE LEE EN LOS DOS SENTIDOS\n");
  const desdeSkf = await equivalentesDe(org.id, skf.id);
  const desdeNsk = await equivalentesDe(org.id, nsk.id);
  revisar("desde SKF ve a NSK", desdeSkf.map((e) => e.refaccion.code), ["BAL-NSK"]);
  revisar("desde NSK ve a SKF", desdeNsk.map((e) => e.refaccion.code), ["BAL-SKF"]);
  revisar("nunca se devuelve a si misma", desdeSkf.some((e) => e.refaccion.id === skf.id), false);
  revisar("trae la existencia de la otra", desdeSkf[0]?.hay, 6);
  revisar("otra organizacion no ve nada", (await equivalentesDe(otra.id, skf.id)).length, 0);

  console.log("\nCON QUE SE PUEDE RESOLVER\n");
  const conQue = await hayConQue(org.id, skf.id);
  revisar("de la propia no hay", conQue.propia, 0);
  revisar("contando equivalentes si hay", conQue.conEquivalentes, 6);
  revisar("dice con cual", conQue.alternativas.map((e) => e.refaccion.code), ["BAL-NSK"]);

  await registrarEquivalencia({ organizationId: org.id, partId: skf.id, equivalenteId: fag.id, tipo: "SUSTITUTO", nota: "Requiere espaciador de 2 mm" });
  const conFag = await equivalentesDe(org.id, skf.id);
  revisar("las que si hay van primero", conFag.map((e) => e.refaccion.code), ["BAL-NSK", "BAL-FAG"]);
  revisar("el sustituto conserva su salvedad", conFag.find((e) => e.tipo === "SUSTITUTO")?.nota, "Requiere espaciador de 2 mm");
  revisar("sin existencia no cuenta como alternativa",
    (await hayConQue(org.id, skf.id)).alternativas.map((e) => e.refaccion.code), ["BAL-NSK"]);

  console.log("\nEL BACKLOG CUENTA LOS EQUIVALENTES\n");
  const site = await prisma.site.create({ data: { organizationId: org.id, code: "P1", name: "Planta" } });
  const asset = await prisma.asset.create({ data: { organizationId: org.id, siteId: site.id, code: "BOM-1", name: "Bomba" } });
  const ot = await prisma.workOrder.create({
    data: {
      organizationId: org.id, number: "OT-1", title: "Cambio de balero", assetId: asset.id, status: "COMPLETED",
      tasks: { create: [{ position: 0, title: "Cambiar balero", origen: "PLAN" }] },
    },
    include: { tasks: true },
  });
  await prisma.workOrderTask.update({
    where: { id: ot.tasks[0].id },
    data: { liberadaAt: new Date(), motivoLiberacion: "SIN_REFACCION", bloqueadaPorPartId: skf.id },
  });

  const b1 = await backlog(org.id);
  revisar("sin la original pero con equivalente: ya se puede", b1[0]?.yaSePuede, true);
  revisar("dice con cual equivalente", b1[0]?.conEquivalente?.refaccion.code, "BAL-NSK");

  await prisma.part.update({ where: { id: nsk.id }, data: { quantityOnHand: 0 } });
  const b2 = await backlog(org.id);
  revisar("sin nada de nada: todavia no", b2[0]?.yaSePuede, false);
  revisar("y no sugiere ninguna", b2[0]?.conEquivalente, null);

  await prisma.part.update({ where: { id: skf.id }, data: { quantityOnHand: 3 } });
  const b3 = await backlog(org.id);
  revisar("con la original: ya se puede", b3[0]?.yaSePuede, true);
  revisar("teniendo la propia no sugiere otra", b3[0]?.conEquivalente, null);

  console.log("\nQUITAR\n");
  await quitarEquivalencia(org.id, desdeSkf[0].id);
  revisar("se quito el par", (await equivalentesDe(org.id, nsk.id)).length, 0);
  await seRechaza("quitar una que no existe", () => quitarEquivalencia(org.id, "inexistente"), "no encontrada");
  revisar("el error trae su codigo", await (async () => {
    try { await quitarEquivalencia(org.id, "x"); return null; }
    catch (e) { return e instanceof ErrorDeEquivalencia ? e.codigo : null; }
  })(), 404);

  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
