/**
 * Un plan para varios equipos, y la fecha de cada actividad en cada equipo.
 *
 * Las dos preguntas de Rafael que la originaron:
 *
 *  1. Si un plan se aplica a uno o más equipos, ¿por qué el plan tenía un campo
 *     de UN equipo? Porque era un resto: al crear servía de atajo, y al editar
 *     escribía un dato que el programador no lee. El alta ahora recibe varios
 *     equipos, y lo que genera órdenes son siempre las asignaciones.
 *  2. Al asociar un equipo, ¿dónde se pone la última vez que se hizo cada
 *     actividad? En ningún lado: todas nacían con la fecha común y no había
 *     cómo corregirlas sin quitar el equipo. `corregirFechas()` lo resuelve.
 *
 * También cubre dos lectores del encabezado viejo que quedaron mal: la
 * importación de planes, que no asignaba el equipo, y el plan por medidor, que
 * exigía el medidor de un solo equipo.
 *
 * Llama a las MISMAS funciones que las rutas —`altaDePlan`, `asignarPlan`,
 * `fechasDeAsignacion`, `corregirFechas`, la definición de importación—, no a
 * una copia de sus pasos.
 *
 *   npx tsx scripts/prueba-fechas-de-actividad.ts
 */
import { prisma } from "../lib/db";
import { altaDePlan } from "../lib/alta-de-plan";
import { asignarPlan } from "../lib/asignaciones";
import { armarOrden } from "../lib/armar-ot";
import { ejecutarImportacion } from "../lib/importacion-motor";
import { ErrorDeFechas, corregirFechas, fechasDeAsignacion } from "../lib/calendario-actividad";
import { startOfDay, addDays } from "../lib/utils";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

const HOY = startOfDay(new Date());
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function falla(fn: () => Promise<unknown>): Promise<ErrorDeFechas | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof ErrorDeFechas) return e;
    throw e;
  }
}

async function main() {
  const sello = `prueba-fechas-${Date.now()}`;
  const org = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const vecino = await prisma.organization.create({ data: { name: `${sello}-v`, slug: `${sello}-v`, plan: "ENTERPRISE" } });
  const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "PL", name: "Planta" } });
  const gestor = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}@x.mx`, name: "Gestor", passwordHash: "x", role: "ADMIN" },
  });
  const equipo = (code: string) =>
    prisma.asset.create({ data: { organizationId: org.id, siteId: sitio.id, code, name: code, status: "OPERATIONAL" } });
  const [cnc1, cnc2, cnc3] = [await equipo("CNC-801"), await equipo("CNC-802"), await equipo("CNC-803")];

  // ── 1 · Un plan, VARIOS equipos, desde el alta ────────────────────────────
  console.log("\nEl alta aplica el plan a varios equipos a la vez");
  const arranque = addDays(HOY, 5);
  const alta = await altaDePlan(org.id, gestor.id, {
    name: "Preventivo centro de maquinado", maintenanceType: "PREVENTIVE", triggerType: "CALENDAR",
    intervalDays: 30, leadTimeDays: 0, toleranceDays: 2, priority: "MEDIUM", estimatedHours: 2,
    requiresShutdown: false, active: true,
    assetIds: [cnc1.id, cnc2.id], desde: ymd(arranque), desdeEsUltima: false,
    tasks: [
      { title: "Limpiar viruta", taskType: "CHECK", required: true, cadaCuanto: 1, unidadFrecuencia: "SEMANAS", labor: [], parts: [], services: [] },
      { title: "Cambiar aceite", taskType: "CHECK", required: true, cadaCuanto: 15, unidadFrecuencia: "DIAS", labor: [], parts: [], services: [] },
      { title: "Medir vibración", taskType: "CHECK", required: true, cadaCuanto: 3, unidadFrecuencia: "MESES", labor: [], parts: [], services: [] },
    ],
  });
  if ("error" in alta) throw new Error(alta.error);
  const asignaciones = await prisma.planAsset.findMany({
    where: { planId: alta.plan.id }, select: { id: true, assetId: true },
  });
  revisar("quedan DOS asignaciones, una por equipo", asignaciones.length === 2, `${asignaciones.length}`);
  const asig1 = asignaciones.find((a) => a.assetId === cnc1.id)!;
  const asig2 = asignaciones.find((a) => a.assetId === cnc2.id)!;

  const f1 = await fechasDeAsignacion(org.id, asig1.id);
  revisar("cada actividad del primer equipo nace con la fecha común",
    !!f1 && f1.actividades.length === 3 && f1.actividades.every((a) => iso(a.proximaEl) === iso(arranque)),
    f1?.actividades.map((a) => `${a.titulo}:${iso(a.proximaEl)}`).join(" · "));
  revisar("y dice su frecuencia como la diría una persona",
    f1?.actividades.map((a) => a.frecuencia).join(" · ") === "Semanal · Cada 15 días · Trimestral",
    f1?.actividades.map((a) => a.frecuencia).join(" · "));

  // ── 2 · Corregir las fechas de UN equipo ──────────────────────────────────
  console.log("\nSe corrige la fecha de cada actividad en un equipo");
  const aceite = f1!.actividades.find((a) => a.titulo === "Cambiar aceite")!;
  const vibracion = f1!.actividades.find((a) => a.titulo === "Medir vibración")!;
  const limpieza = f1!.actividades.find((a) => a.titulo === "Limpiar viruta")!;
  const hace10 = addDays(HOY, -10);
  const tocaVibracion = addDays(HOY, 40);

  const r = await corregirFechas({
    organizationId: org.id, userId: gestor.id, planAssetId: asig1.id,
    cambios: [
      { planTaskId: aceite.planTaskId, fecha: hace10, esUltima: true },
      { planTaskId: vibracion.planTaskId, fecha: tocaVibracion, esUltima: false },
    ],
  });
  revisar("reporta las dos corregidas", r.cambiadas.length === 2);

  const d1 = await fechasDeAsignacion(org.id, asig1.id);
  const de = (t: string) => d1!.actividades.find((a) => a.titulo === t)!;
  revisar("«la última vez hace 10 días» + cada 15 días → toca en 5 días",
    iso(de("Cambiar aceite").proximaEl) === iso(addDays(HOY, 5)), iso(de("Cambiar aceite").proximaEl));
  revisar("y queda registrada esa última vez", iso(de("Cambiar aceite").ultimaEl) === iso(hace10));
  revisar("«toca el día X» pone esa fecha tal cual",
    iso(de("Medir vibración").proximaEl) === iso(tocaVibracion), iso(de("Medir vibración").proximaEl));
  revisar("la que no se tocó conserva la fecha común",
    iso(de("Limpiar viruta").proximaEl) === iso(arranque), iso(de("Limpiar viruta").proximaEl));

  const d2 = await fechasDeAsignacion(org.id, asig2.id);
  revisar("el OTRO equipo del mismo plan no se movió",
    d2!.actividades.every((a) => iso(a.proximaEl) === iso(arranque)),
    d2!.actividades.map((a) => iso(a.proximaEl)).join(" · "));

  const pa1 = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig1.id }, select: { nextDueDate: true } });
  revisar("la fecha resumen del equipo pasa a la más próxima de sus actividades",
    iso(pa1.nextDueDate) === iso(arranque), iso(pa1.nextDueDate));
  const bitacora = await prisma.auditLog.findFirst({
    where: { organizationId: org.id, entity: "PlanAsset", entityId: asig1.id }, select: { summary: true },
  });
  revisar("el cambio queda en la bitácora con antes y después",
    !!bitacora?.summary?.includes("Cambiar aceite") && bitacora.summary.includes("→"), bitacora?.summary ?? "(nada)");

  console.log("\nUna «última vez» que ya pasó un intervalo deja la actividad atrasada, que es la verdad");
  await corregirFechas({
    organizationId: org.id, userId: gestor.id, planAssetId: asig2.id,
    cambios: [{ planTaskId: limpieza.planTaskId, fecha: addDays(HOY, -20), esUltima: true }],
  });
  const d2b = await fechasDeAsignacion(org.id, asig2.id);
  const limp2 = d2b!.actividades.find((a) => a.titulo === "Limpiar viruta")!;
  revisar("hace 20 días + semanal → atrasada", limp2.atrasada === true, `${iso(limp2.proximaEl)} atrasada=${limp2.atrasada}`);

  // ── 3 · Lo que NO debe pasar ──────────────────────────────────────────────
  console.log("\nTodo o nada: un cambio inválido no deja los demás a medias");
  const antesInvalido = await fechasDeAsignacion(org.id, asig1.id);
  const eFuturo = await falla(() => corregirFechas({
    organizationId: org.id, userId: gestor.id, planAssetId: asig1.id,
    cambios: [
      { planTaskId: limpieza.planTaskId, fecha: addDays(HOY, 2), esUltima: false },
      { planTaskId: aceite.planTaskId, fecha: addDays(HOY, 3), esUltima: true },
    ],
  }));
  revisar("«la última vez» en el futuro se rechaza", !!eFuturo?.message.includes("futuro"), eFuturo?.message);
  const despuesInvalido = await fechasDeAsignacion(org.id, asig1.id);
  revisar("y la otra actividad del mismo envío NO se cambió",
    JSON.stringify(antesInvalido!.actividades.map((a) => iso(a.proximaEl))) ===
      JSON.stringify(despuesInvalido!.actividades.map((a) => iso(a.proximaEl))));

  console.log("\nLo que ya va en una orden no se corrige: su fecha la mueve el cierre");
  const orden = await armarOrden({
    organizationId: org.id, userId: gestor.id, assetId: cnc1.id, title: "Aceite",
    actividades: [aceite.planTaskId], reportes: [], backlog: [],
  });
  if ("error" in orden) throw new Error(orden.error);
  const eOrden = await falla(() => corregirFechas({
    organizationId: org.id, userId: gestor.id, planAssetId: asig1.id,
    cambios: [{ planTaskId: aceite.planTaskId, fecha: HOY, esUltima: false }],
  }));
  revisar("se rechaza con el folio de la orden", eOrden?.codigo === 409 && eOrden.message.includes(orden.orden.number), eOrden?.message);
  const f1b = await fechasDeAsignacion(org.id, asig1.id);
  revisar("y la pantalla la muestra bloqueada",
    f1b!.actividades.find((a) => a.titulo === "Cambiar aceite")!.bloqueo?.includes(orden.orden.number) === true,
    f1b!.actividades.find((a) => a.titulo === "Cambiar aceite")!.bloqueo ?? "(sin bloqueo)");

  console.log("\nCada empresa ve y corrige solo lo suyo");
  revisar("la empresa vecina no puede leer esas fechas", (await fechasDeAsignacion(vecino.id, asig1.id)) === null);
  const eVecino = await falla(() => corregirFechas({
    organizationId: vecino.id, userId: null, planAssetId: asig1.id,
    cambios: [{ planTaskId: limpieza.planTaskId, fecha: HOY, esUltima: false }],
  }));
  revisar("ni corregirlas", eVecino?.codigo === 404, eVecino?.message);
  const otroPlan = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Otro", triggerType: "CALENDAR", intervalDays: 30, active: true,
      tasks: { create: [{ position: 0, title: "Ajena", taskType: "CHECK", required: true }] },
    },
    include: { tasks: true },
  });
  const eAjena = await falla(() => corregirFechas({
    organizationId: org.id, userId: gestor.id, planAssetId: asig1.id,
    cambios: [{ planTaskId: otroPlan.tasks[0].id, fecha: HOY, esUltima: false }],
  }));
  revisar("una actividad de otro plan se rechaza", eAjena?.codigo === 404, eAjena?.message);

  // ── 4 · Fechas distintas desde la asignación ──────────────────────────────
  console.log("\nAl asignar, algunas actividades pueden ir en otra fecha");
  await asignarPlan({
    organizationId: org.id, planId: alta.plan.id, userId: gestor.id,
    equipos: [{
      assetId: cnc3.id, desde: arranque, desdeEsUltima: false,
      porActividad: [{ planTaskId: vibracion.planTaskId, fecha: addDays(HOY, 60), esUltima: false }],
    }],
  });
  const asig3 = await prisma.planAsset.findFirstOrThrow({ where: { planId: alta.plan.id, assetId: cnc3.id } });
  const d3 = await fechasDeAsignacion(org.id, asig3.id);
  revisar("la distinta toma su fecha",
    iso(d3!.actividades.find((a) => a.titulo === "Medir vibración")!.proximaEl) === iso(addDays(HOY, 60)));
  revisar("y las demás la común",
    d3!.actividades.filter((a) => a.titulo !== "Medir vibración").every((a) => iso(a.proximaEl) === iso(arranque)));

  // ── 5 · Plan por medidor: el medidor es de cada equipo ────────────────────
  console.log("\nUn plan por medidor ya no pide el medidor de un solo equipo");
  const conHorometro = await equipo("CMP-801");
  const sinHorometro = await equipo("CMP-802");
  await prisma.meter.create({ data: { organizationId: org.id, assetId: conHorometro.id, name: "Horómetro", unit: "h" } });
  const altaMedidor = await altaDePlan(org.id, gestor.id, {
    name: "Servicio 2,000 h", maintenanceType: "PREVENTIVE", triggerType: "METER",
    intervalMeter: 2000, leadTimeDays: 0, toleranceDays: 2, priority: "MEDIUM", estimatedHours: 4,
    requiresShutdown: false, active: true, assetIds: [conHorometro.id, sinHorometro.id],
    tasks: [{ title: "Cambiar separador", taskType: "CHECK", required: true, labor: [], parts: [], services: [] }],
  });
  revisar("se crea sin elegir medidor en el plan", !("error" in altaMedidor), "error" in altaMedidor ? altaMedidor.error : "ok");
  if (!("error" in altaMedidor)) {
    revisar("y dice qué equipo se quedó sin medidor", altaMedidor.sinMedidor.join() === "CMP-802", altaMedidor.sinMedidor.join());
    const asigMedidor = await prisma.planAsset.findMany({
      where: { planId: altaMedidor.plan.id }, select: { assetId: true, meterId: true, id: true },
    });
    revisar("el equipo con horómetro quedó ligado al suyo",
      !!asigMedidor.find((a) => a.assetId === conHorometro.id)?.meterId);
    const sinMed = asigMedidor.find((a) => a.assetId === sinHorometro.id)!;
    const fm = await fechasDeAsignacion(org.id, sinMed.id);
    revisar("la pantalla de fechas lo marca como sin medidor", fm?.porMedidor === true && fm.sinMedidor === true);
    const eMed = await falla(() => corregirFechas({
      organizationId: org.id, userId: gestor.id, planAssetId: sinMed.id,
      cambios: [{ planTaskId: otroPlan.tasks[0].id, fecha: HOY, esUltima: false }],
    }));
    revisar("y no deja capturar fechas en un plan por medidor", !!eMed?.message.includes("medidor"), eMed?.message);
  }

  // ── 6 · La importación asigna el equipo ───────────────────────────────────
  console.log("\nUn plan importado queda aplicado a su equipo, no solo anotado");
  // Por el motor de importación, que es lo que corre la pantalla: el plan y
  // su asignación se crean en la misma transacción.
  const importado = await ejecutarImportacion({
    tipo: "planes",
    contenido: "nombre,activo,cada_dias\nImportado,CNC-801,30",
    organizationId: org.id, userId: gestor.id, plan: "ENTERPRISE",
    // Ese equipo ya tiene un plan cada 30 días: el motor lo marca como posible
    // duplicado, y crearlo pide decirlo expresamente.
    decisiones: { exactos: "omitir", crearPosibles: [2] },
  });
  revisar("el renglón se importa", importado.creados === 1, JSON.stringify(importado));
  const insertado = await prisma.maintenancePlan.findFirstOrThrow({ where: { organizationId: org.id, name: "Importado" } });
  const asigImport = await prisma.planAsset.count({ where: { planId: insertado.id, assetId: cnc1.id, active: true } });
  revisar("y tiene su asignación: sin ella el programador nunca lo vería", asigImport === 1, `${asigImport}`);

  // ── Limpieza ─────────────────────────────────────────────────────────────
  for (const o of [org.id, vecino.id]) {
    await prisma.workOrderTask.deleteMany({ where: { workOrder: { organizationId: o } } });
    await prisma.workOrder.deleteMany({ where: { organizationId: o } });
    await prisma.planTaskAsset.deleteMany({ where: { organizationId: o } });
    await prisma.planAsset.deleteMany({ where: { organizationId: o } });
    await prisma.planTask.deleteMany({ where: { plan: { organizationId: o } } });
    await prisma.maintenancePlan.deleteMany({ where: { organizationId: o } });
    await prisma.meter.deleteMany({ where: { organizationId: o } });
    await prisma.asset.deleteMany({ where: { organizationId: o } });
    await prisma.site.deleteMany({ where: { organizationId: o } });
    await prisma.auditLog.deleteMany({ where: { organizationId: o } });
    await prisma.notification.deleteMany({ where: { organizationId: o } });
    await prisma.user.deleteMany({ where: { organizationId: o } });
    await prisma.organization.delete({ where: { id: o } });
  }

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
