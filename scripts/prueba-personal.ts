/**
 * Prueba de la carga del equipo.
 *
 * Lo que mas se cuida: que no se atribuya a una persona lo que no es suyo. Un
 * porcentaje mal calculado sobre el trabajo de alguien no es un error de
 * redondeo, es una injusticia con cara de dato.
 */
import { PrismaClient } from "@prisma/client";
import { cargaDelEquipo } from "../lib/personal";

const prisma = new PrismaClient();
let fallas = 0;
function revisar(e: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(54)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

async function main() {
  const sufijo = Date.now();
  const org = await prisma.organization.create({
    data: { name: "Prueba equipo", slug: `pq-${sufijo}`, horasJornada: 8 },
  });
  const site = await prisma.site.create({ data: { organizationId: org.id, code: "P", name: "Planta" } });
  const activo = await prisma.asset.create({ data: { organizationId: org.id, siteId: site.id, code: "BOM-1", name: "Bomba" } });

  const persona = (name: string, horas: number | null = null, role = "TECHNICIAN") =>
    prisma.user.create({
      data: { organizationId: org.id, email: `${name}-${sufijo}@x.mx`, name, passwordHash: "x", role, horasDisponibles: horas },
    });

  const juan = await persona("Juan");
  const ana = await persona("Ana", 4);
  await persona("Visor", null, "VIEWER");

  const ayer = new Date(Date.now() - 86_400_000);
  const anteayer = new Date(Date.now() - 2 * 86_400_000);

  const ot = async (numero: string, datos: Record<string, unknown>) =>
    prisma.workOrder.create({ data: { organizationId: org.id, number: numero, title: numero, assetId: activo.id, ...datos } });

  // Abiertas
  await ot("A-1", { status: "OPEN", assignedToId: juan.id, estimatedHours: 4, dueDate: new Date(Date.now() - 86_400_000) });
  await ot("A-2", { status: "OPEN", assignedToId: juan.id, estimatedHours: 3 });
  await ot("A-3", { status: "OPEN", estimatedHours: 5 }); // sin responsable

  // Cerradas con horas capturadas
  const c1 = await ot("C-1", { status: "CLOSED", assignedToId: juan.id, estimatedHours: 2, completedAt: ayer, dueDate: ayer, maintenanceType: "CORRECTIVE" });
  const c2 = await ot("C-2", { status: "CLOSED", assignedToId: juan.id, estimatedHours: 2, completedAt: ayer, dueDate: anteayer, maintenanceType: "PREVENTIVE" });
  const c3 = await ot("C-3", { status: "CLOSED", assignedToId: juan.id, estimatedHours: 2, completedAt: ayer, dueDate: ayer, maintenanceType: "CORRECTIVE" });
  // Compartida: dos personas capturaron horas. NO debe entrar a la comparacion.
  const c4 = await ot("C-4", { status: "CLOSED", assignedToId: juan.id, estimatedHours: 10, completedAt: ayer, maintenanceType: "CORRECTIVE" });

  const labor = (woId: string, userId: string, hours: number, cost = 0) =>
    prisma.workOrderLabor.create({ data: { workOrderId: woId, userId, hours, cost, workedAt: ayer } });

  await labor(c1.id, juan.id, 3, 300);
  await labor(c2.id, juan.id, 2, 200);
  await labor(c3.id, juan.id, 4, 400);
  await labor(c4.id, juan.id, 5, 500);
  await labor(c4.id, ana.id, 5, 500);

  const r = await cargaDelEquipo(org.id);
  const j = r.personas.find((p) => p.nombre === "Juan")!;
  const a = r.personas.find((p) => p.nombre === "Ana")!;

  console.log("\nQUIEN ENTRA\n");
  revisar("solo quien ejecuta trabajo", r.personas.map((p) => p.nombre).sort(), ["Ana", "Juan"]);
  revisar("un VIEWER no aparece", r.personas.some((p) => p.nombre === "Visor"), false);

  console.log("\nLO QUE TRAE ASIGNADO\n");
  revisar("Juan trae 2 ordenes", j.asignado.ordenes, 2);
  revisar("suma sus horas comprometidas", j.asignado.horas, 7);
  revisar("cuenta lo vencido", j.asignado.vencidas, 1);
  revisar("lo sin responsable se ve aparte", r.sinResponsable, { ordenes: 1, horas: 5 });

  console.log("\nHORAS APLICADAS\n");
  revisar("Juan aplico 14 horas", j.aplicado.horas, 14);
  revisar("y su costo", j.aplicado.costo, 1400);
  revisar("Ana solo las suyas", a.aplicado.horas, 5);
  revisar("desglose por tipo", j.aplicado.porTipo, { CORRECTIVE: 12, PREVENTIVE: 2 });
  revisar("porcentaje de correctivo", j.aplicado.porcentajeCorrectivo, 86);

  console.log("\nESTIMADO CONTRA REAL: SOLO LO ATRIBUIBLE\n");
  revisar("la compartida NO entra", j.estimacion.ordenes, 3);
  revisar("estimadas de las tres", j.estimacion.estimadas, 6);
  revisar("reales de las tres", j.estimacion.reales, 9);
  revisar("desviacion 150%", j.estimacion.desviacion, 150);
  revisar("Ana no tiene base propia", a.estimacion.ordenes, 0);
  revisar("sin base no se inventa desviacion", a.estimacion.desviacion, null);

  console.log("\nNO SE OPINA CON POCOS CASOS\n");
  const org2 = await prisma.organization.create({ data: { name: "Chica", slug: `ch-${sufijo}` } });
  const s2 = await prisma.site.create({ data: { organizationId: org2.id, code: "P", name: "P" } });
  const a2 = await prisma.asset.create({ data: { organizationId: org2.id, siteId: s2.id, code: "X", name: "X" } });
  const p2 = await prisma.user.create({ data: { organizationId: org2.id, email: `u-${sufijo}@x.mx`, name: "Solo", passwordHash: "x", role: "TECHNICIAN" } });
  const o2 = await prisma.workOrder.create({ data: { organizationId: org2.id, number: "U-1", title: "u", assetId: a2.id, status: "CLOSED", assignedToId: p2.id, estimatedHours: 2, completedAt: ayer, dueDate: ayer } });
  await prisma.workOrderLabor.create({ data: { workOrderId: o2.id, userId: p2.id, hours: 9, workedAt: ayer } });
  const r2 = await cargaDelEquipo(org2.id);
  revisar("con una sola orden no hay desviacion", r2.personas[0].estimacion.desviacion, null);
  revisar("pero si se dice con cuantas se calculo", r2.personas[0].estimacion.ordenes, 1);
  revisar("ni puntualidad con una sola", r2.personas[0].puntualidad.porcentaje, null);

  console.log("\nCADA ORGANIZACION LO SUYO\n");
  revisar("no se mezclan equipos", r.personas.some((p) => p.nombre === "Solo"), false);
  revisar("filtro por persona funciona",
    (await cargaDelEquipo(org.id, { soloUserId: juan.id })).personas.map((p) => p.nombre), ["Juan"]);

  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
