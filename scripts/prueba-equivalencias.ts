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
import { paresCandidatos } from "../lib/ia/equivalencias";

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

  console.log("\nEL FILTRO ANTES DE LA IA\n");
  // Lo que nunca debe llegarle al modelo: piezas de medida distinta.
  const cat = [
    { id: "1", code: "BAL-SKF", name: "Balero 6205 SKF", category: "Baleros" },
    { id: "2", code: "BAL-NSK", name: "Rodamiento 6205 NSK", category: "Baleros" },
    { id: "3", code: "BAL-206", name: "Balero 6206 SKF", category: "Baleros" },
    { id: "4", code: "BAN-A52", name: "Banda A-52", category: "Bandas" },
    { id: "5", code: "BAN-A52B", name: "Banda A52 Gates", category: "Bandas" },
    { id: "6", code: "ACE-15W40", name: "Aceite 15W40", category: "Lubricantes" },
  ];
  const cands = paresCandidatos(cat, new Set());
  const par = (a: string, b: string) =>
    cands.some((c) => (c.a.code === a && c.b.code === b) || (c.a.code === b && c.b.code === a));

  revisar("6205 SKF con 6205 NSK: si es candidato", par("BAL-SKF", "BAL-NSK"), true);
  revisar("6205 con 6206: NUNCA llega al modelo", par("BAL-SKF", "BAL-206"), false);
  revisar("6205 NSK con 6206: tampoco", par("BAL-NSK", "BAL-206"), false);
  revisar("dos bandas A52: si es candidato", par("BAN-A52", "BAN-A52B"), true);
  revisar("un balero y un aceite: no", par("BAL-SKF", "ACE-15W40"), false);
  revisar("nada se compara consigo mismo", cands.some((c) => c.a.id === c.b.id), false);

  const yaHay = new Set(["1|2"]);
  revisar("lo ya registrado no se vuelve a proponer",
    paresCandidatos(cat, yaHay).some((c) => (c.a.id === "1" && c.b.id === "2")), false);
  // El consecutivo del codigo interno no es una designacion.
  const conConsecutivos = [
    { id: "1", code: "BOM-001", name: "Bomba", category: null },
    { id: "2", code: "CLIM-001", name: "Minisplit", category: null },
    { id: "3", code: "TAB-001", name: "Tablero", category: null },
    { id: "4", code: "MOT-001", name: "Motor", category: null },
    { id: "5", code: "VAL-001", name: "Valvula", category: null },
    { id: "6", code: "FIL-001", name: "Filtro", category: null },
    { id: "7", code: "BAL-6205-A", name: "Balero 6205 SKF", category: null },
    { id: "8", code: "BAL-6205-B", name: "Balero 6205 NSK", category: null },
  ];
  const podados = paresCandidatos(conConsecutivos, new Set());
  revisar("el consecutivo 001 no genera pares",
    podados.some((c) => c.a.code === "BOM-001" || c.b.code === "CLIM-001"), false);
  revisar("pero la designacion real si",
    podados.some((c) => [c.a.code, c.b.code].sort().join() === "BAL-6205-A,BAL-6205-B"), true);

  revisar("sin designacion numerica no hay candidatos",
    paresCandidatos([
      { id: "a", code: "TRA-1", name: "Trapo industrial", category: null },
      { id: "b", code: "TRA-2", name: "Trapo de algodon", category: null },
    ], new Set()).length, 0);

  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
