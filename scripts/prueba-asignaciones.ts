/**
 * Prueba de planes aplicados a varios equipos.
 *
 * Lo que se cuida por encima de todo: que diez compresores con el mismo plan
 * NO generen orden el mismo dia, y que cerrar la de uno no mueva la de los
 * otros nueve. Ese es el motivo entero de que la asignacion exista.
 */
import { PrismaClient } from "@prisma/client";
import { asignarPlan, escalonar, quitarAsignacion, ErrorDeAsignacion } from "../lib/asignaciones";
import { generateScheduledWorkOrders, rollForwardPlan } from "../lib/scheduler";

const prisma = new PrismaClient();
let fallas = 0;
function revisar(e: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(52)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}
async function seRechaza(e: string, fn: () => Promise<unknown>, frag: string) {
  try { await fn(); fallas++; console.log(`  FALLA ${e.padEnd(52)} no se rechazo`); }
  catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    const bien = m.toLowerCase().includes(frag.toLowerCase());
    if (!bien) fallas++;
    console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(52)} ${bien ? "rechazado" : m}`);
  }
}
const iso = (d: Date | null) => d ? d.toISOString().slice(0, 10) : null;

async function main() {
  const suf = Date.now();
  const org = await prisma.organization.create({
    data: { name: "Prueba planes", slug: `pp-${suf}`, diasHabiles: "1,2,3,4,5" },
  });
  const otra = await prisma.organization.create({ data: { name: "Ajena", slug: `ap-${suf}` } });
  const site = await prisma.site.create({ data: { organizationId: org.id, code: "P", name: "Planta" } });

  const compresor = (code: string, crit = "B", orgId = org.id, siteId = site.id) =>
    prisma.asset.create({ data: { organizationId: orgId, siteId, code, name: `Compresor ${code}`, criticality: crit } });

  const equipos = await Promise.all(["C-1","C-2","C-3","C-4","C-5"].map((c) => compresor(c)));
  await prisma.asset.update({ where: { id: equipos[3].id }, data: { criticality: "A" } });

  const plan = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Preventivo mensual compresor",
      triggerType: "CALENDAR", intervalDays: 30, estimatedHours: 2,
      tasks: { create: [{ position: 0, title: "Cambiar filtro", required: true }] },
    },
  });

  console.log("\nUN PLAN, VARIOS EQUIPOS\n");
  const r = await asignarPlan({
    organizationId: org.id, planId: plan.id,
    equipos: equipos.map((e) => ({ assetId: e.id })),
    escalonarAuto: true,
  });
  revisar("se asignan los cinco", r.creadas.length, 5);
  revisar("un solo plan en el catalogo",
    await prisma.maintenancePlan.count({ where: { organizationId: org.id } }), 1);

  const asigs = await prisma.planAsset.findMany({
    where: { planId: plan.id }, include: { asset: true }, orderBy: { nextDueDate: "asc" },
  });
  const fechas = asigs.map((a) => iso(a.nextDueDate));
  revisar("cada equipo tiene SU fecha", new Set(fechas).size > 1, true);
  console.log(`       ${asigs.map((a) => `${a.asset.code}:${iso(a.nextDueDate)}`).join("  ")}`);
  revisar("ninguna cae en sabado o domingo",
    asigs.every((a) => ![0, 6].includes(a.nextDueDate!.getDay())), true);
  revisar("el critico va primero", asigs[0].asset.code, "C-4");

  console.log("\nNO SE DUPLICA NI SE CUELA LO AJENO\n");
  const r2 = await asignarPlan({ organizationId: org.id, planId: plan.id, equipos: [{ assetId: equipos[0].id }] });
  revisar("reasignar el mismo equipo no duplica", r2.yaEstaban.length, 1);
  revisar("y sigue habiendo cinco", await prisma.planAsset.count({ where: { planId: plan.id } }), 5);

  const s2 = await prisma.site.create({ data: { organizationId: otra.id, code: "X", name: "X" } });
  const ajeno = await compresor("C-AJENO", "B", otra.id, s2.id);
  await seRechaza("un equipo de otra empresa",
    () => asignarPlan({ organizationId: org.id, planId: plan.id, equipos: [{ assetId: ajeno.id }] }), "no existe");
  await seRechaza("sin equipos",
    () => asignarPlan({ organizationId: org.id, planId: plan.id, equipos: [] }), "al menos un equipo");

  console.log("\nEL PROGRAMADOR GENERA POR EQUIPO\n");
  // Vencer solo dos de los cinco
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  await prisma.planAsset.updateMany({
    where: { id: { in: [asigs[0].id, asigs[1].id] } }, data: { nextDueDate: ayer },
  });
  const gen = await generateScheduledWorkOrders(org.id, {});
  revisar("genera solo las dos vencidas", gen.generated, 2);
  const ots = await prisma.workOrder.findMany({ where: { organizationId: org.id }, select: { assetId: true, planId: true } });
  revisar("una orden por equipo, no una por plan", new Set(ots.map((o) => o.assetId)).size, 2);
  revisar("todas cuelgan del mismo plan", new Set(ots.map((o) => o.planId)).size, 1);
  revisar("las otras tres siguen esperando",
    (await prisma.planAsset.count({ where: { planId: plan.id, lastGeneratedAt: null } })), 3);

  console.log("\nCERRAR UNA NO MUEVE A LAS DEMAS\n");
  const antes = await prisma.planAsset.findMany({
    where: { planId: plan.id }, select: { assetId: true, nextDueDate: true },
  });
  const unaOt = ots[0];
  await rollForwardPlan(plan.id, hoy, null, unaOt.assetId);
  const despues = await prisma.planAsset.findMany({
    where: { planId: plan.id }, select: { assetId: true, nextDueDate: true, lastCompletedAt: true },
  });
  const cambiadas = despues.filter((d) => {
    const a = antes.find((x) => x.assetId === d.assetId);
    return iso(a!.nextDueDate) !== iso(d.nextDueDate);
  });
  revisar("solo se movio la del equipo cerrado", cambiadas.length, 1);
  revisar("y fue la correcta", cambiadas[0]?.assetId, unaOt.assetId);
  revisar("avanzo 30 dias", iso(cambiadas[0]?.nextDueDate ?? null),
    iso(new Date(hoy.getTime() + 30 * 86_400_000)));
  revisar("las demas conservan su fecha",
    despues.filter((d) => d.assetId !== unaOt.assetId).every((d) =>
      iso(d.nextDueDate) === iso(antes.find((x) => x.assetId === d.assetId)!.nextDueDate)), true);

  console.log("\nEL ESCALONAMIENTO EN SI\n");
  const habilSiempre = () => true;
  const rep = escalonar(
    [1,2,3,4].map((n) => ({ assetId: `a${n}`, criticidad: "B", ultimoServicio: null })),
    new Date(2026, 8, 7), 30, habilSiempre,
  );
  revisar("reparte dentro del intervalo",
    rep.every((x) => (x.fecha.getTime() - new Date(2026,8,7).getTime()) / 86_400_000 <= 30), true);
  revisar("no todos el mismo dia", new Set(rep.map((x) => iso(x.fecha))).size, 4);
  revisar("el primero arranca hoy", iso(rep[0].fecha), "2026-09-07");
  const uno = escalonar([{ assetId: "solo", criticidad: "B", ultimoServicio: null }], new Date(2026,8,7), 30, habilSiempre);
  revisar("con un solo equipo, arranca hoy", iso(uno[0].fecha), "2026-09-07");

  console.log("\nPLANES POR MEDIDOR\n");
  // El caso que se me escapo: un plan por horas de operacion no lleva fechas,
  // y un equipo sin medidor se ve asignado pero no genera nunca.
  const conMedidor = await compresor("M-1");
  const sinMedidor = await compresor("M-2");
  await prisma.meter.create({
    data: { organizationId: org.id, assetId: conMedidor.id, name: "Horas", unit: "h", currentValue: 1900, dailyAverage: 10 },
  });
  const planMedidor = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Servicio 2000 h", triggerType: "METER", intervalMeter: 2000,
      tasks: { create: [{ position: 0, title: "Cambio de aceite" }] },
    },
  });
  const rm = await asignarPlan({
    organizationId: org.id, planId: planMedidor.id,
    equipos: [{ assetId: conMedidor.id }, { assetId: sinMedidor.id }],
    escalonarAuto: true,
  });
  revisar("avisa cual equipo no tiene medidor", rm.sinMedidor, ["M-2"]);

  const asigsM = await prisma.planAsset.findMany({
    where: { planId: planMedidor.id }, include: { asset: true },
  });
  revisar("no inventa fecha en plan por medidor",
    asigsM.every((a) => a.nextDueDate === null), true);
  revisar("liga solo el medidor que existe",
    asigsM.filter((a) => a.meterId !== null).map((a) => a.asset.code), ["M-1"]);

  const genM = await generateScheduledWorkOrders(org.id, {});
  const motivoM2 = genM.details.find((d) => (d.reason ?? "").includes("M-2"))?.reason ?? "";
  revisar("el motivo nombra al equipo y la causa",
    /M-2.*medidor/i.test(motivoM2), true);
  console.log(`       «${motivoM2}»`);
  revisar("el que si tiene medidor no se salta por esa causa",
    genM.details.some((d) => (d.reason ?? "").includes("M-1") && /medidor/i.test(d.reason ?? "")), false);

  console.log("\nQUITAR\n");
  await quitarAsignacion(org.id, asigs[4].id);
  revisar("queda fuera del plan", await prisma.planAsset.count({ where: { planId: plan.id } }), 4);
  await seRechaza("quitar una que no existe", () => quitarAsignacion(org.id, "x"), "no encontrada");
  revisar("el error trae su codigo", await (async () => {
    try { await quitarAsignacion(org.id, "y"); return null; }
    catch (e) { return e instanceof ErrorDeAsignacion ? e.codigo : null; }
  })(), 404);

  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
