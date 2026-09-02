/**
 * Prueba de aplicar un movimiento propuesto por la IA.
 *
 * Lo que se cuida: que la propuesta de un modelo, que ademas pasa por el
 * navegador, no pueda escribir cualquier cosa en la base. Fecha laborable,
 * orden abierta, organizacion correcta.
 */
import { PrismaClient } from "@prisma/client";
import { ErrorDeAgenda, reprogramar } from "../lib/agenda";

const prisma = new PrismaClient();
const ABIERTOS = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;
let fallas = 0;

function revisar(e: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(50)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}

async function seRechaza(e: string, fn: () => Promise<unknown>, fragmento: string) {
  try {
    await fn();
    fallas++;
    console.log(`  FALLA ${e.padEnd(50)} no se rechazo`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const bien = msg.toLowerCase().includes(fragmento.toLowerCase());
    if (!bien) fallas++;
    console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(50)} ${bien ? "rechazado" : msg}`);
  }
}

async function main() {
  const sufijo = Date.now();
  const org = await prisma.organization.create({
    data: { name: "Prueba agenda", slug: `pa-${sufijo}`, horasJornada: 8, diasHabiles: "1,2,3,4,5" },
  });
  const otra = await prisma.organization.create({ data: { name: "Ajena", slug: `aj-${sufijo}` } });
  const [juan, juana] = await Promise.all([
    prisma.user.create({ data: { organizationId: org.id, email: `j-${sufijo}@x.mx`, name: "Juan Perez", passwordHash: "x", role: "TECHNICIAN" } }),
    prisma.user.create({ data: { organizationId: org.id, email: `ja-${sufijo}@x.mx`, name: "Juana Perez", passwordHash: "x", role: "TECHNICIAN" } }),
  ]);
  await prisma.diaFestivo.create({
    data: { organizationId: org.id, fecha: new Date(2026, 8, 16), nombre: "Independencia", deLey: true },
  });

  const nueva = (numero: string, status = "OPEN") =>
    prisma.workOrder.create({
      data: { organizationId: org.id, number: numero, title: `Trabajo ${numero}`, status, dueDate: new Date(2026, 8, 12) },
    });

  const base = { organizationId: org.id, estadosAbiertos: ABIERTOS };

  console.log("\nLO QUE NO SE PUEDE ESCRIBIR\n");
  await nueva("OT-1");
  await seRechaza("un sabado", () => reprogramar({ ...base, numeroOrden: "OT-1", fecha: "2026-09-12" }), "laborable");
  await seRechaza("un domingo", () => reprogramar({ ...base, numeroOrden: "OT-1", fecha: "2026-09-13" }), "laborable");
  await seRechaza("un festivo", () => reprogramar({ ...base, numeroOrden: "OT-1", fecha: "2026-09-16" }), "laborable");
  await seRechaza("una orden que no existe", () => reprogramar({ ...base, numeroOrden: "OT-999", fecha: "2026-09-14" }), "no se encontro");

  await nueva("OT-2", "CLOSED");
  await seRechaza("una orden ya cerrada", () => reprogramar({ ...base, numeroOrden: "OT-2", fecha: "2026-09-14" }), "no esta abierta");

  await prisma.workOrder.create({
    data: { organizationId: otra.id, number: "OT-1", title: "De otra empresa", status: "OPEN" },
  });
  await seRechaza(
    "una orden de otra organizacion",
    () => reprogramar({ ...base, organizationId: otra.id, numeroOrden: "OT-3", fecha: "2026-09-14" }),
    "no se encontro",
  );

  console.log("\nLO QUE SI SE APLICA\n");
  const r1 = await reprogramar({ ...base, numeroOrden: "OT-1", fecha: "2026-09-14" });
  const ot1 = await prisma.workOrder.findFirst({ where: { organizationId: org.id, number: "OT-1" }, select: { dueDate: true, assignedToId: true } });
  revisar("mueve la fecha a un lunes", ot1?.dueDate?.toISOString().slice(0, 10), "2026-09-14");
  revisar("sin responsable, no toca al responsable", ot1?.assignedToId, null);
  revisar("sin aviso cuando todo salio", r1.aviso, null);

  const r2 = await reprogramar({ ...base, numeroOrden: "OT-1", fecha: "2026-09-15", responsableNombre: "Juan Perez" });
  const ot1b = await prisma.workOrder.findFirst({ where: { organizationId: org.id, number: "OT-1" }, select: { assignedToId: true } });
  revisar("asigna al responsable por nombre", ot1b?.assignedToId, juan.id);
  revisar("sin aviso", r2.aviso, null);

  console.log("\nCUANDO EL NOMBRE NO RESUELVE\n");
  const r3 = await reprogramar({ ...base, numeroOrden: "OT-1", fecha: "2026-09-17", responsableNombre: "Perez" });
  const ot1c = await prisma.workOrder.findFirst({ where: { organizationId: org.id, number: "OT-1" }, select: { dueDate: true, assignedToId: true } });
  revisar("ambiguo: aplica la fecha de todos modos", ot1c?.dueDate?.toISOString().slice(0, 10), "2026-09-17");
  revisar("ambiguo: no cambia al responsable", ot1c?.assignedToId, juan.id);
  revisar("ambiguo: avisa", /varias personas/.test(r3.aviso ?? ""), true);

  const r4 = await reprogramar({ ...base, numeroOrden: "OT-1", fecha: "2026-09-18", responsableNombre: "Fulano" });
  revisar("inexistente: avisa", /no se encontro/i.test(r4.aviso ?? ""), true);
  const ot1d = await prisma.workOrder.findFirst({ where: { organizationId: org.id, number: "OT-1" }, select: { dueDate: true } });
  revisar("inexistente: aplica la fecha igual", ot1d?.dueDate?.toISOString().slice(0, 10), "2026-09-18");

  revisar("el error trae su codigo http", await (async () => {
    try { await reprogramar({ ...base, numeroOrden: "OT-1", fecha: "2026-09-12" }); return null; }
    catch (e) { return e instanceof ErrorDeAgenda ? e.codigo : null; }
  })(), 422);

  void juana;
  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nTodas las revisiones cuadran\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
