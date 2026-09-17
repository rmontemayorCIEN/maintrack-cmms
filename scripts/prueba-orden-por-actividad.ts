/**
 * El gestor elige actividad por actividad qué va en cada orden.
 *
 * El caso, en palabras de Rafael: un plan de cinco actividades que caen la
 * misma semana. El gestor manda tres en una orden y las otras dos quedan
 * para otra. Elegir una actividad no arrastra al resto del plan. Las que se
 * pasan de fecha sin estar en ninguna orden se ven como atrasadas, y al armar
 * una orden se puede decidir qué tan adelante mirar: la semana, el mes, los
 * próximos 30 días.
 *
 * La prueba llama a las MISMAS funciones que la pantalla y la ruta
 * —`trabajoDisponible`, `armarOrden`, `transitionWorkOrder`,
 * `generateScheduledWorkOrders`— y no a una copia de sus pasos.
 *
 *   npx tsx scripts/prueba-orden-por-actividad.ts
 */
import { prisma } from "../lib/db";
import { asignarPlan } from "../lib/asignaciones";
import { armarOrden, trabajoDisponible } from "../lib/armar-ot";
import { transitionWorkOrder } from "../lib/workorders";
import { generateScheduledWorkOrders } from "../lib/scheduler";
import { limiteDeVentana } from "../lib/calendario";
import { refaccionesDelPlan } from "../lib/requisiciones";
import { filtroDeActividadesDeLaOrden } from "../lib/plan-tasks";
import { startOfDay, addDays } from "../lib/utils";

/**
 * Lo minimo que el ciclo de la OT exige (lib/reglas-ot.ts) para las ordenes de
 * esta prueba, que prueba otra cosa. Los campos propios de cada llamada ganan.
 */
const CICLO_DE_PRUEBA = {
  rol: "OWNER",
  tomarla: true,
  motivo: "Motivo de prueba automatizada",
  resolution: "Trabajo realizado en prueba automatizada",
  motivoSinHoras: "Prueba automatizada sin horas",
  motivoSinDiagnostico: "Prueba automatizada sin diagnóstico",
};


let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

const HOY = startOfDay(new Date());
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

async function cerrar(workOrderId: string, organizationId: string, userId: string) {
  // Lo que no se libero, se hizo.
  await prisma.workOrderTask.updateMany({
    where: { workOrderId, liberadaAt: null },
    data: { done: true, completedAt: new Date() },
  });
  for (const to of ["IN_PROGRESS", "COMPLETED"]) {
    await transitionWorkOrder({ ...CICLO_DE_PRUEBA, workOrderId, to, userId, organizationId });
  }
}

async function main() {
  // ── La aritmetica de la ventana, sin base de datos ────────────────────────
  console.log("\nQué tan adelante mira cada ventana");
  const miercoles = new Date(2026, 8, 16, 10, 0); // mié 16 sep 2026
  revisar("«esta semana» un miércoles termina el domingo 20",
    iso(limiteDeVentana("SEMANA", miercoles, 15)) === "2026-09-20" ||
      limiteDeVentana("SEMANA", miercoles, 15).getDate() === 20,
    limiteDeVentana("SEMANA", miercoles, 15).toDateString());
  const domingo = new Date(2026, 8, 20, 10, 0);
  revisar("«esta semana» un domingo termina ese mismo domingo",
    limiteDeVentana("SEMANA", domingo, 15).getDate() === 20,
    limiteDeVentana("SEMANA", domingo, 15).toDateString());
  revisar("«este mes» el 16 de septiembre termina el 30, no a los 30 días",
    limiteDeVentana("MES", miercoles, 15).getDate() === 30 &&
      limiteDeVentana("MES", miercoles, 15).getMonth() === 8,
    limiteDeVentana("MES", miercoles, 15).toDateString());
  revisar("«próximos 30 días» el 16 de septiembre llega al 16 de octubre",
    limiteDeVentana("DIAS_30", miercoles, 15).getDate() === 16 &&
      limiteDeVentana("DIAS_30", miercoles, 15).getMonth() === 9,
    limiteDeVentana("DIAS_30", miercoles, 15).toDateString());
  revisar("«la de la empresa» usa sus días configurados",
    limiteDeVentana("CONFIGURADA", miercoles, 15).getDate() === 1 &&
      limiteDeVentana("CONFIGURADA", miercoles, 15).getMonth() === 9,
    limiteDeVentana("CONFIGURADA", miercoles, 15).toDateString());

  // ── El escenario ─────────────────────────────────────────────────────────
  const sello = `prueba-ot-act-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", otHorizonteDias: 15 },
  });
  const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "PL", name: "Planta" } });
  const gestor = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}@x.mx`, name: "Gestor", passwordHash: "x", role: "ADMIN" },
  });
  const tecnico = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}-t@x.mx`, name: "Técnico", passwordHash: "x", role: "TECHNICIAN" },
  });
  const compresor = await prisma.asset.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "CMP-900", name: "Compresor 900", status: "OPERATIONAL" },
  });
  const otroEquipo = await prisma.asset.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "BOM-900", name: "Bomba 900", status: "OPERATIONAL" },
  });

  const titulos = ["Cambiar aceite", "Cambiar filtro de aire", "Revisar bandas", "Purgar condensados", "Medir vibración"];
  const plan = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Preventivo compresor", maintenanceType: "PREVENTIVE",
      triggerType: "CALENDAR", intervalDays: 30, estimatedHours: 4, active: true, leadTimeDays: 0,
      priority: "MEDIUM",
      tasks: {
        create: [
          ...titulos.map((title, position) => ({
            position, title, taskType: "CHECK", required: true, cadaCuanto: 1, unidadFrecuencia: "MESES",
          })),
          // Una sexta que cae lejos, para probar las ventanas.
          { position: 9, title: "Revisión anual", taskType: "CHECK", required: true, cadaCuanto: 12, unidadFrecuencia: "MESES" },
        ],
      },
    },
    include: { tasks: { orderBy: { position: "asc" } } },
  });
  const cinco = plan.tasks.slice(0, 5);
  const anual = plan.tasks[5];
  const [aceite, filtro, bandas, purga, vibracion] = cinco;

  // Las cinco caen dentro de los próximos 3 días; la anual, en 20.
  await asignarPlan({
    organizationId: org.id, planId: plan.id, userId: gestor.id,
    equipos: [{
      assetId: compresor.id,
      porActividad: [
        ...cinco.map((t, i) => ({ planTaskId: t.id, fecha: addDays(HOY, i % 3), esUltima: false })),
        { planTaskId: anual.id, fecha: addDays(HOY, 20), esUltima: false },
      ],
    }],
  });

  // Un plan del OTRO equipo, para probar que no se cuela.
  const planAjeno = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Preventivo bomba", maintenanceType: "PREVENTIVE",
      triggerType: "CALENDAR", intervalDays: 30, active: true,
      tasks: { create: [{ position: 0, title: "Cambiar sello", taskType: "CHECK", required: true, cadaCuanto: 1, unidadFrecuencia: "MESES" }] },
    },
    include: { tasks: true },
  });
  await asignarPlan({
    organizationId: org.id, planId: planAjeno.id, userId: gestor.id,
    equipos: [{ assetId: otroEquipo.id, desde: HOY, desdeEsUltima: false }],
  });

  console.log("\nLo que se ofrece son actividades sueltas, cada una con su fecha");
  const d1 = await trabajoDisponible(org.id, compresor.id, { ventana: "DIAS_7" });
  const ofrecidas1 = d1.planes[0]?.actividades ?? [];
  revisar("con «próximos 7 días» se ofrecen las cinco de esta semana", ofrecidas1.length === 5,
    ofrecidas1.map((a) => a.title).join(", "));
  revisar("y NO la anual, que cae en 20 días", !ofrecidas1.some((a) => a.id === anual.id));
  const d30 = await trabajoDisponible(org.id, compresor.id, { ventana: "DIAS_30" });
  revisar("con «próximos 30 días» sí aparece la anual",
    (d30.planes[0]?.actividades ?? []).some((a) => a.id === anual.id));

  console.log("\nEl gestor manda TRES de las cinco en una orden");
  const r1 = await armarOrden({
    organizationId: org.id, userId: gestor.id, assetId: compresor.id,
    title: "Tres del compresor", assignedToId: tecnico.id,
    actividades: [aceite.id, filtro.id, bandas.id], reportes: [], backlog: [],
  });
  if ("error" in r1) throw new Error(r1.error);
  const tareas1 = await prisma.workOrderTask.findMany({
    where: { workOrderId: r1.orden.id }, select: { title: true, planTaskId: true },
  });
  revisar("la orden trae exactamente las tres elegidas", tareas1.length === 3,
    tareas1.map((t) => t.title).join(", "));
  revisar("elegir tres NO arrastró a las otras del plan",
    !tareas1.some((t) => t.planTaskId === purga.id || t.planTaskId === vibracion.id));
  revisar("cada una sabe de qué actividad del plan salió", tareas1.every((t) => t.planTaskId));

  console.log("\nLas otras dos siguen disponibles; las tres ya no se ofrecen");
  const d2 = await trabajoDisponible(org.id, compresor.id, { ventana: "DIAS_7" });
  const p2 = d2.planes[0];
  revisar("se ofrecen solo purga y vibración",
    (p2?.actividades ?? []).map((a) => a.id).sort().join() === [purga.id, vibracion.id].sort().join(),
    (p2?.actividades ?? []).map((a) => a.title).join(", "));
  revisar("y las tres elegidas se nombran con la orden donde van",
    (p2?.yaEnOrden ?? []).length === 3 && (p2?.yaEnOrden ?? []).every((a) => a.orden === r1.orden.number),
    (p2?.yaEnOrden ?? []).map((a) => `${a.title}→${a.orden}`).join(", "));

  console.log("\nLo que se prepara y se pide al almacén es de ESTA orden, no del plan");
  // El aceite pide su aceite; la revisión anual pide rodamientos. Una orden con
  // solo el aceite no debe mandar al almacén por rodamientos.
  const aceiteRef = await prisma.part.create({
    data: { organizationId: org.id, code: "ACE-01", name: "Aceite de compresor", unit: "l" },
  });
  const rodamiento = await prisma.part.create({
    data: { organizationId: org.id, code: "ROD-01", name: "Rodamiento 6205", unit: "pza" },
  });
  await prisma.planTaskPart.createMany({
    data: [
      { planTaskId: aceite.id, partId: aceiteRef.id, quantity: 4 },
      { planTaskId: anual.id, partId: rodamiento.id, quantity: 2 },
    ],
  });
  const req = await refaccionesDelPlan(org.id, r1.orden.id);
  const codigos = (req?.renglones ?? []).map((x) => x.code);
  revisar("la requisición pide el aceite de la actividad que trae la orden", codigos.includes("ACE-01"),
    codigos.join(", ") || "(nada)");
  revisar("y NO los rodamientos de la revisión anual, que no va en esta orden", !codigos.includes("ROD-01"));
  const deLaOrden = await filtroDeActividadesDeLaOrden(r1.orden.id);
  const planeadas = deLaOrden ? await prisma.planTask.findMany({ where: deLaOrden, select: { id: true } }) : [];
  revisar("los recursos planeados salen de sus 3 actividades, no de las 6 del plan", planeadas.length === 3,
    `${planeadas.length}`);

  console.log("\nLa misma actividad no puede ir en dos órdenes");
  const doble = await armarOrden({
    organizationId: org.id, userId: gestor.id, assetId: compresor.id,
    title: "Intento duplicado", actividades: [aceite.id, purga.id], reportes: [], backlog: [],
  });
  revisar("se rechaza y dice en qué orden está",
    "error" in doble && doble.codigo === 409 && doble.error.includes(r1.orden.number),
    "error" in doble ? doble.error : "SE COLÓ");
  const cuantasOrdenes = await prisma.workOrder.count({ where: { organizationId: org.id, assetId: compresor.id } });
  revisar("y no se creó ninguna orden a medias", cuantasOrdenes === 1, `${cuantasOrdenes}`);

  console.log("\nNo se cuela la actividad del plan de otro equipo");
  const ajena = await armarOrden({
    organizationId: org.id, userId: gestor.id, assetId: compresor.id,
    title: "Ajena", actividades: [planAjeno.tasks[0].id], reportes: [], backlog: [],
  });
  revisar("se rechaza", "error" in ajena && ajena.codigo === 404, "error" in ajena ? ajena.error : "SE COLÓ");

  console.log("\nLas que se pasan de fecha sin orden se ven ATRASADAS");
  await prisma.planTaskAsset.updateMany({
    where: { assetId: compresor.id, planTaskId: { in: [purga.id, vibracion.id] } },
    data: { proximaEl: addDays(HOY, -2) },
  });
  const d3 = await trabajoDisponible(org.id, compresor.id, { ventana: "ATRASADAS" });
  const p3 = d3.planes[0];
  revisar("el resumen cuenta dos atrasadas", d3.atrasadas === 2, `${d3.atrasadas}`);
  revisar("las dos vienen marcadas como atrasadas, con sus días",
    (p3?.actividades ?? []).length === 2 &&
      (p3?.actividades ?? []).every((a) => a.atrasada && a.faltan === -2),
    (p3?.actividades ?? []).map((a) => `${a.title}:${a.faltan}`).join(", "));
  const d3b = await trabajoDisponible(org.id, compresor.id, { ventana: "DIAS_30" });
  revisar("con una ventana amplia, las atrasadas van PRIMERO en el plan",
    (d3b.planes[0]?.actividades ?? []).slice(0, 2).every((a) => a.atrasada),
    (d3b.planes[0]?.actividades ?? []).map((a) => `${a.title}${a.atrasada ? "*" : ""}`).join(", "));
  revisar("y «solo atrasadas» no muestra la anual del futuro",
    !(p3?.actividades ?? []).some((a) => a.id === anual.id));

  console.log("\nAl cerrar, avanza solo el reloj de lo que traía la orden");
  const r2 = await armarOrden({
    organizationId: org.id, userId: gestor.id, assetId: compresor.id,
    title: "Las dos atrasadas", actividades: [purga.id, vibracion.id], reportes: [], backlog: [],
  });
  if ("error" in r2) throw new Error(r2.error);
  const vence2 = await prisma.workOrder.findUniqueOrThrow({ where: { id: r2.orden.id }, select: { dueDate: true } });
  revisar("sin vencimiento capturado, la orden hereda el de la actividad más próxima",
    iso(vence2.dueDate) === iso(addDays(HOY, -2)), iso(vence2.dueDate));

  await cerrar(r1.orden.id, org.id, gestor.id);
  const relojes = await prisma.planTaskAsset.findMany({
    where: { assetId: compresor.id }, select: { planTaskId: true, proximaEl: true },
  });
  const fecha = (id: string) => relojes.find((r) => r.planTaskId === id)?.proximaEl ?? null;
  revisar("las tres de la primera orden se recorren un mes",
    [aceite, filtro, bandas].every((t) => (fecha(t.id)?.getTime() ?? 0) > addDays(HOY, 25).getTime()),
    [aceite, filtro, bandas].map((t) => iso(fecha(t.id))).join(" · "));
  revisar("las dos de la segunda orden, que sigue abierta, no se mueven",
    [purga, vibracion].every((t) => iso(fecha(t.id)) === iso(addDays(HOY, -2))),
    [purga, vibracion].map((t) => iso(fecha(t.id))).join(" · "));

  console.log("\nLo liberado se ofrece por el backlog, y al retomarlo SÍ avanza su reloj");
  await prisma.workOrderTask.updateMany({
    where: { workOrderId: r2.orden.id, planTaskId: vibracion.id },
    data: { liberadaAt: new Date(), motivoLiberacion: "SIN_ACCESO" },
  });
  await cerrar(r2.orden.id, org.id, gestor.id);
  const d4 = await trabajoDisponible(org.id, compresor.id, { ventana: "DIAS_7" });
  revisar("la liberada aparece en el backlog", d4.backlog.some((b) => b.title === "Medir vibración"));
  revisar("y NO se ofrece además como actividad del plan (saldría dos veces)",
    !(d4.planes[0]?.actividades ?? []).some((a) => a.id === vibracion.id));
  const deBacklog = d4.backlog.find((b) => b.title === "Medir vibración")!;
  const r3 = await armarOrden({
    organizationId: org.id, userId: gestor.id, assetId: compresor.id,
    title: "Retomar vibración", actividades: [], reportes: [], backlog: [deBacklog.id],
  });
  if ("error" in r3) throw new Error(r3.error);
  const retomada = await prisma.workOrderTask.findFirstOrThrow({
    where: { workOrderId: r3.orden.id }, select: { planTaskId: true },
  });
  revisar("la retomada conserva de qué actividad salió", retomada.planTaskId === vibracion.id,
    retomada.planTaskId ?? "null");
  await cerrar(r3.orden.id, org.id, gestor.id);
  const vibDespues = await prisma.planTaskAsset.findFirstOrThrow({
    where: { assetId: compresor.id, planTaskId: vibracion.id }, select: { proximaEl: true },
  });
  revisar("y al cerrarla su reloj avanza: ya no queda atrasada para siempre",
    (vibDespues.proximaEl?.getTime() ?? 0) > addDays(HOY, 25).getTime(), iso(vibDespues.proximaEl));

  console.log("\nEn modo MANUAL el programador no arma órdenes, pero avisa");
  await prisma.organization.update({ where: { id: org.id }, data: { otGeneracion: "MANUAL" } });
  // Vence algo para que haya qué avisar.
  await prisma.planTaskAsset.update({
    where: { planTaskId_assetId: { planTaskId: aceite.id, assetId: compresor.id } },
    data: { proximaEl: addDays(HOY, -1) },
  });
  const antes = await prisma.workOrder.count({ where: { organizationId: org.id } });
  const gen = await generateScheduledWorkOrders(org.id, {});
  const despues = await prisma.workOrder.count({ where: { organizationId: org.id } });
  revisar("no crea ninguna orden de calendario", despues === antes && gen.generated === 0,
    `${antes} → ${despues}`);
  const avisos = await prisma.notification.findMany({
    where: { organizationId: org.id, title: { contains: "atrasadas" } }, select: { userId: true, body: true },
  });
  revisar("avisa a quien puede armar órdenes", avisos.some((a) => a.userId === gestor.id),
    avisos[0]?.body ?? "sin aviso");
  revisar("y no al técnico, que no puede armarlas", !avisos.some((a) => a.userId === tecnico.id));
  await generateScheduledWorkOrders(org.id, {});
  const avisos2 = await prisma.notification.count({
    where: { organizationId: org.id, userId: gestor.id, title: { contains: "atrasadas" } },
  });
  revisar("un segundo barrido el mismo día NO repite el aviso", avisos2 === 1, `${avisos2}`);

  console.log("\nEn modo AUTOMÁTICO sí la arma");
  await prisma.organization.update({ where: { id: org.id }, data: { otGeneracion: "AUTOMATICA" } });
  const genAuto = await generateScheduledWorkOrders(org.id, {});
  revisar("vuelve a generar", genAuto.generated >= 1, `${genAuto.generated}`);

  console.log("\nEn modo AUTOMÁTICO, lo liberado espera en el backlog: no se regenera");
  // El defecto: el candado ignora lo liberado, y el barrido de la hora
  // siguiente armaba OTRA orden para el mismo balero que no llegó —igual de
  // trabada— mientras el backlog la seguía mostrando para siempre.
  const molino = await prisma.asset.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "MOL-900", name: "Molino 900", status: "OPERATIONAL" },
  });
  const planMolino = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Preventivo molino", maintenanceType: "PREVENTIVE",
      triggerType: "CALENDAR", intervalDays: 30, active: true, leadTimeDays: 0, priority: "MEDIUM",
      tasks: { create: [{ position: 0, title: "Cambiar balero", taskType: "CHECK", required: true, cadaCuanto: 1, unidadFrecuencia: "MESES" }] },
    },
    include: { tasks: true },
  });
  const balero = planMolino.tasks[0];
  await asignarPlan({
    organizationId: org.id, planId: planMolino.id, userId: gestor.id,
    equipos: [{ assetId: molino.id, desde: HOY, desdeEsUltima: false }],
  });
  const ordenesDelMolino = () => prisma.workOrder.count({ where: { organizationId: org.id, assetId: molino.id } });

  await generateScheduledWorkOrders(org.id, {});
  const otA = await prisma.workOrder.findFirstOrThrow({ where: { organizationId: org.id, assetId: molino.id } });
  revisar("el programador arma la orden del balero", (await ordenesDelMolino()) === 1);

  await prisma.workOrderTask.updateMany({
    where: { workOrderId: otA.id },
    data: { liberadaAt: new Date(), motivoLiberacion: "SIN_REFACCION" },
  });
  const genLib = await generateScheduledWorkOrders(org.id, {});
  revisar("liberada con su orden abierta, el barrido siguiente NO arma otra",
    (await ordenesDelMolino()) === 1, `${await ordenesDelMolino()} órdenes`);
  revisar("y dice por qué: espera en el backlog",
    genLib.details.some((d) => d.reason?.includes("MOL-900") && d.reason.includes("backlog")),
    genLib.details.find((d) => d.reason?.includes("MOL-900"))?.reason ?? "(sin motivo)");

  await cerrar(otA.id, org.id, gestor.id);
  await generateScheduledWorkOrders(org.id, {});
  revisar("tampoco después de cerrar esa orden", (await ordenesDelMolino()) === 1, `${await ordenesDelMolino()} órdenes`);

  const directa = await armarOrden({
    organizationId: org.id, userId: gestor.id, assetId: molino.id,
    title: "Por la puerta de atrás", actividades: [balero.id], reportes: [], backlog: [],
  });
  revisar("elegirla como actividad del plan se rechaza: se retoma desde el backlog",
    "error" in directa && directa.codigo === 409 && directa.error.includes("pendiente"),
    "error" in directa ? directa.error : "SE COLÓ");

  const dMolino = await trabajoDisponible(org.id, molino.id, { ventana: "DIAS_7" });
  const trabado = dMolino.backlog.find((b) => b.title === "Cambiar balero");
  revisar("el armador la ofrece en «Quedó pendiente»", !!trabado);
  const retomar = await armarOrden({
    organizationId: org.id, userId: gestor.id, assetId: molino.id,
    title: "Ya llegó el balero", actividades: [], reportes: [], backlog: [trabado!.id],
  });
  if ("error" in retomar) throw new Error(retomar.error);
  await generateScheduledWorkOrders(org.id, {});
  revisar("retomada, el programador no duplica mientras la orden está abierta",
    (await ordenesDelMolino()) === 2, `${await ordenesDelMolino()} órdenes`);
  await cerrar(retomar.orden.id, org.id, gestor.id);
  const relojBalero = await prisma.planTaskAsset.findFirstOrThrow({
    where: { assetId: molino.id, planTaskId: balero.id }, select: { proximaEl: true },
  });
  const dFinal = await trabajoDisponible(org.id, molino.id, { ventana: "DIAS_7" });
  revisar("al cerrarla su reloj avanza un mes", (relojBalero.proximaEl?.getTime() ?? 0) > addDays(HOY, 25).getTime(),
    iso(relojBalero.proximaEl));
  revisar("y sale del backlog", !dFinal.backlog.some((b) => b.title === "Cambiar balero"));

  // ── Limpieza ─────────────────────────────────────────────────────────────
  await prisma.workOrderTask.deleteMany({ where: { workOrder: { organizationId: org.id } } });
  await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
  await prisma.planTaskAsset.deleteMany({ where: { organizationId: org.id } });
  await prisma.planTaskPart.deleteMany({ where: { part: { organizationId: org.id } } });
  await prisma.part.deleteMany({ where: { organizationId: org.id } });
  await prisma.planAsset.deleteMany({ where: { organizationId: org.id } });
  await prisma.planTask.deleteMany({ where: { plan: { organizationId: org.id } } });
  await prisma.maintenancePlan.deleteMany({ where: { organizationId: org.id } });
  await prisma.asset.deleteMany({ where: { organizationId: org.id } });
  await prisma.site.deleteMany({ where: { organizationId: org.id } });
  await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
  await prisma.notification.deleteMany({ where: { organizationId: org.id } });
  await prisma.user.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
