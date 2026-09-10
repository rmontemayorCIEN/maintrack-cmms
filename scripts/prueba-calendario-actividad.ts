/**
 * El calendario por actividad, de extremo a extremo.
 *
 * El caso es el montacargas: un solo plan cuyas actividades van a ritmos que
 * NO son multiplos entre si —engrase semanal, aceite cada 15 dias, revision
 * trimestral—. Con la cadencia base anterior eso obligaba a una base de un dia
 * y a 365 vueltas al ano, de las que 302 no producian nada.
 *
 * La prueba llama a las MISMAS funciones que las rutas —`altaDePlan`,
 * `asignarPlan`, `generateScheduledWorkOrders`, `completarOrden`— y no una
 * copia de sus pasos. Ya paso una vez que la prueba asignaba por su cuenta, el
 * endpoint nunca asignaba, y las dos pasaban.
 *
 *   npx tsx scripts/prueba-calendario-actividad.ts
 */
import { prisma } from "../lib/db";
import { altaDePlan } from "../lib/alta-de-plan";
import { asignarPlan } from "../lib/asignaciones";
import { generateScheduledWorkOrders } from "../lib/scheduler";
import { transitionWorkOrder } from "../lib/workorders";
import { actividadesPendientes, actividadesSinProgramar } from "../lib/calendario-actividad";
import { startOfDay, addDays } from "../lib/utils";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

const HOY = startOfDay(new Date());
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");
const enDias = (n: number) => iso(addDays(HOY, n));

/** Una OT no salta de OPEN a COMPLETED: pasa por IN_PROGRESS, como en la vida. */
async function cerrar(workOrderId: string, organizationId: string, userId: string) {
  for (const to of ["IN_PROGRESS", "COMPLETED"]) {
    await transitionWorkOrder({ workOrderId, to, userId, organizationId });
  }
}

async function relojDe(planTaskId: string, assetId: string) {
  return prisma.planTaskAsset.findUnique({
    where: { planTaskId_assetId: { planTaskId, assetId } },
    select: { proximaEl: true, ultimaEl: true, arranqueEl: true },
  });
}

async function main() {
  const sello = `prueba-cal-act-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", otHorizonteDias: 15 },
  });
  const vecino = await prisma.organization.create({
    data: { name: `${sello}-v`, slug: `${sello}-v`, plan: "ENTERPRISE" },
  });
  const sitio = await prisma.site.create({
    data: { organizationId: org.id, code: "PL", name: "Planta" },
  });
  const gestor = await prisma.user.create({
    data: {
      organizationId: org.id, email: `${sello}@x.mx`, name: "Gestor",
      passwordHash: "x", role: "ADMIN",
    },
  });
  const monta = await prisma.asset.create({
    data: {
      organizationId: org.id, siteId: sitio.id, code: "MON-900",
      name: "Montacargas 900", status: "OPERATIONAL",
    },
  });

  // ── El plan del montacargas ────────────────────────────────────────────
  const alta = await altaDePlan(org.id, gestor.id, {
    name: "Preventivo montacargas",
    maintenanceType: "PREVENTIVE",
    triggerType: "CALENDAR",
    intervalDays: 7,
    priority: "MEDIUM",
    leadTimeDays: 0,
    estimatedHours: 2,
    tasks: [
      { title: "Engrase de cadenas", taskType: "CHECK", required: true, cadaCuanto: 1, unidadFrecuencia: "SEMANAS", labor: [], parts: [], services: [] },
      { title: "Cambio de aceite", taskType: "CHECK", required: true, cadaCuanto: 15, unidadFrecuencia: "DIAS", labor: [], parts: [], services: [] },
      { title: "Revisión general", taskType: "CHECK", required: true, cadaCuanto: 3, unidadFrecuencia: "MESES", labor: [], parts: [], services: [] },
    ],
  } as never);
  if ("error" in alta) throw new Error(`No se pudo crear el plan: ${alta.error}`);
  const planId = alta.plan.id;

  const tareas = await prisma.planTask.findMany({
    where: { planId },
    orderBy: { position: "asc" },
    select: { id: true, title: true, cadaCuanto: true, unidadFrecuencia: true },
  });
  const porTitulo = new Map(tareas.map((t) => [t.title, t]));
  const engrase = porTitulo.get("Engrase de cadenas")!;
  const aceite = porTitulo.get("Cambio de aceite")!;
  const revision = porTitulo.get("Revisión general")!;

  console.log("\nCada actividad guarda su propia frecuencia, en su propia unidad");
  revisar("engrase: 1 SEMANAS", engrase.cadaCuanto === 1 && engrase.unidadFrecuencia === "SEMANAS",
    `${engrase.cadaCuanto} ${engrase.unidadFrecuencia}`);
  revisar("aceite: 15 DIAS", aceite.cadaCuanto === 15 && aceite.unidadFrecuencia === "DIAS",
    `${aceite.cadaCuanto} ${aceite.unidadFrecuencia}`);
  revisar("revisión: 3 MESES", revision.cadaCuanto === 3 && revision.unidadFrecuencia === "MESES",
    `${revision.cadaCuanto} ${revision.unidadFrecuencia}`);

  // ── El arranque: la primera vez no hay historial ───────────────────────
  //
  // `altaDePlan` ya asigno el plan al equipo si traia assetId; aqui no lo
  // traia, asi que se asigna con las fechas de arranque por actividad, que es
  // el caso que Rafael describio: alguien dice cuando se hizo cada una la
  // ultima vez.
  await asignarPlan({
    organizationId: org.id,
    planId,
    userId: gestor.id,
    equipos: [{
      assetId: monta.id,
      porActividad: [
        { planTaskId: engrase.id, fecha: addDays(HOY, -7), esUltima: true },
        { planTaskId: aceite.id, fecha: addDays(HOY, -15), esUltima: true },
        { planTaskId: revision.id, fecha: addDays(HOY, -30), esUltima: true },
      ],
    }],
  });

  console.log("\nEl arranque declarado da una fecha distinta a cada actividad");
  const rEngrase = await relojDe(engrase.id, monta.id);
  const rAceite = await relojDe(aceite.id, monta.id);
  const rRevision = await relojDe(revision.id, monta.id);
  revisar("engrase: se hizo hace 7 días, toca hoy", iso(rEngrase?.proximaEl) === enDias(0), iso(rEngrase?.proximaEl));
  revisar("aceite: se hizo hace 15 días, toca hoy", iso(rAceite?.proximaEl) === enDias(0), iso(rAceite?.proximaEl));
  revisar(
    "revisión: se hizo hace un mes, toca en dos meses",
    rRevision?.proximaEl !== null && (rRevision!.proximaEl as Date) > addDays(HOY, 45),
    iso(rRevision?.proximaEl),
  );
  revisar("y ninguna quedó sin programar", (await actividadesSinProgramar(org.id)).length === 0);

  console.log("\n«Arranca el día X» NO es lo mismo que «la última vez fue el día X»");
  const otro = await prisma.asset.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "MON-901", name: "Montacargas 901", status: "OPERATIONAL" },
  });
  await asignarPlan({
    organizationId: org.id, planId, userId: gestor.id,
    equipos: [{ assetId: otro.id, desde: addDays(HOY, 3), desdeEsUltima: false }],
  });
  const arranca = await relojDe(aceite.id, otro.id);
  revisar(
    "«arranca el día 3» hace que toque ESE día, no 15 después",
    iso(arranca?.proximaEl) === enDias(3),
    iso(arranca?.proximaEl),
  );

  // ── La generación ──────────────────────────────────────────────────────
  console.log("\nUna sola orden junta lo que cae dentro de la ventana");
  const gen = await generateScheduledWorkOrders(org.id, { userId: gestor.id });
  const ots = await prisma.workOrder.findMany({
    where: { organizationId: org.id, assetId: monta.id },
    include: { tasks: { select: { title: true, planTaskId: true } } },
  });
  revisar("se generó una orden para el montacargas", ots.length === 1, `${ots.length} órdenes · ${gen.generated} generadas`);
  const titulos = (ots[0]?.tasks ?? []).map((t) => t.title).sort();
  revisar(
    "trae el engrase y el aceite —los dos que tocan hoy— en UNA sola",
    titulos.join(" + ") === "Cambio de aceite + Engrase de cadenas",
    titulos.join(" + ") || "(vacía)",
  );
  revisar(
    "y NO trae la revisión trimestral, que vence en dos meses",
    !titulos.includes("Revisión general"),
  );
  revisar(
    "cada actividad de la orden conserva de qué actividad del plan salió",
    (ots[0]?.tasks ?? []).every((t) => t.planTaskId),
  );

  console.log("\nGenerar NO adelanta el reloj: eso pasa al cerrar");
  const trasGenerar = await relojDe(engrase.id, monta.id);
  revisar("el engrase sigue venciendo hoy", iso(trasGenerar?.proximaEl) === enDias(0), iso(trasGenerar?.proximaEl));

  console.log("\nLo que ya está en una orden abierta no se vuelve a ofrecer");
  const gen2 = await generateScheduledWorkOrders(org.id, { userId: gestor.id });
  const ots2 = await prisma.workOrder.count({ where: { organizationId: org.id, assetId: monta.id } });
  revisar("un segundo barrido no duplica la orden", ots2 === 1, `${ots2} órdenes, ${gen2.generated} nuevas`);

  // ── El cierre ──────────────────────────────────────────────────────────
  console.log("\nAl cerrar, avanza SOLO el reloj de lo que se hizo");
  await prisma.workOrderTask.updateMany({
    where: { workOrderId: ots[0].id },
    data: { done: true, completedAt: new Date() },
  });
  await cerrar(ots[0].id, org.id, gestor.id);

  const dEngrase = await relojDe(engrase.id, monta.id);
  const dAceite = await relojDe(aceite.id, monta.id);
  const dRevision = await relojDe(revision.id, monta.id);
  revisar("el engrase se recorre una semana", iso(dEngrase?.proximaEl) === enDias(7), iso(dEngrase?.proximaEl));
  revisar("el aceite se recorre 15 días", iso(dAceite?.proximaEl) === enDias(15), iso(dAceite?.proximaEl));
  revisar(
    "la revisión trimestral NO se movió: no se hizo",
    iso(dRevision?.proximaEl) === iso(rRevision?.proximaEl),
    `${iso(rRevision?.proximaEl)} → ${iso(dRevision?.proximaEl)}`,
  );
  revisar("y las dos que sí se hicieron registran cuándo", !!dEngrase?.ultimaEl && !!dAceite?.ultimaEl);

  console.log("\nUna actividad LIBERADA no avanza: no se hizo");
  // Se fuerza el vencimiento del engrase para que vuelva a salir.
  await prisma.planTaskAsset.update({
    where: { planTaskId_assetId: { planTaskId: engrase.id, assetId: monta.id } },
    data: { proximaEl: HOY },
  });
  await generateScheduledWorkOrders(org.id, { userId: gestor.id });
  const ot2 = await prisma.workOrder.findFirst({
    where: { organizationId: org.id, assetId: monta.id, status: { in: ["OPEN", "ASSIGNED"] } },
    include: { tasks: true },
    orderBy: { createdAt: "desc" },
  });
  revisar("vuelve a salir en una orden nueva", !!ot2 && ot2.tasks.length > 0, `${ot2?.number ?? "ninguna"}`);
  if (ot2) {
    const antes = await relojDe(engrase.id, monta.id);
    await prisma.workOrderTask.updateMany({
      where: { workOrderId: ot2.id },
      data: { liberadaAt: new Date(), motivoLiberacion: "SIN_REFACCION" },
    });
    await cerrar(ot2.id, org.id, gestor.id);
    const despues = await relojDe(engrase.id, monta.id);
    revisar(
      "liberada, el reloj se queda donde estaba",
      iso(despues?.proximaEl) === iso(antes?.proximaEl),
      `${iso(antes?.proximaEl)} → ${iso(despues?.proximaEl)}`,
    );
  }

  console.log("\nUn equipo dado de baja no genera nada");
  await prisma.asset.update({ where: { id: otro.id }, data: { status: "RETIRED" } });
  const pendientesBaja = await actividadesPendientes(org.id, { assetId: otro.id, hasta: addDays(HOY, 400) });
  revisar("no aparece ni una actividad pendiente suya", pendientesBaja.length === 0, `${pendientesBaja.length}`);

  console.log("\nCada empresa ve solo lo suyo");
  const ajenas = await actividadesPendientes(vecino.id, { hasta: addDays(HOY, 400) });
  revisar("la empresa vecina no ve ninguna actividad de esta", ajenas.length === 0, `${ajenas.length}`);

  // ── Limpieza ───────────────────────────────────────────────────────────
  for (const o of [org.id, vecino.id]) {
    await prisma.workOrderTask.deleteMany({ where: { workOrder: { organizationId: o } } });
    await prisma.workOrder.deleteMany({ where: { organizationId: o } });
    await prisma.planTaskAsset.deleteMany({ where: { organizationId: o } });
    await prisma.planAsset.deleteMany({ where: { organizationId: o } });
    await prisma.planTask.deleteMany({ where: { plan: { organizationId: o } } });
    await prisma.maintenancePlan.deleteMany({ where: { organizationId: o } });
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
