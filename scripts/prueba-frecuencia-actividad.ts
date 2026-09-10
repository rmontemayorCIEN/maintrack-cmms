/**
 * Cada actividad con su propia frecuencia, dentro de un solo plan.
 *
 * El caso de Rafael: el aceite se cambia cada mes y el liquido de frenos cada
 * seis. Con la frecuencia unica del plan, o se cambia el aceite de mas o el
 * filtro de menos —y no avisa, que es lo peor—.
 *
 * Lo que se prueba es lo que ningun arreglo con varios planes puede dar:
 *
 *   - el ANIDAMIENTO: en la sexta ejecucion entran las tres, en UNA orden
 *   - el caso viejo intacto: con cadaCuantas en 1 todo sale siempre
 *   - los ciclos vacios no emiten orden, pero SI avanzan el contador
 *   - las horas estimadas son las de lo que entro, no las del servicio completo
 *
 *   npx tsx scripts/prueba-frecuencia-actividad.ts
 */
import { prisma } from "../lib/db";
import { generateScheduledWorkOrders, forecastSchedule, rollForwardPlan } from "../lib/scheduler";
import { trabajoDisponible } from "../lib/armar-ot";
import { derivarCadencia, tocanEn, diasDe, resolverCadenciaDelPlan } from "../lib/frecuencias";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  console.log("\nDerivar la cadencia base de los días que pide el usuario");
  const d1 = derivarCadencia([{ cadaDias: 30 }, { cadaDias: 90 }, { cadaDias: 180 }]);
  revisar("30, 90 y 180 días dan base 30", d1.base === 30, `base ${d1.base}`);
  revisar("y múltiplos 1, 3 y 6",
    JSON.stringify(d1.actividades.map((a) => a.cadaCuantas)) === "[1,3,6]",
    d1.actividades.map((a) => a.cadaCuantas).join(","));

  const d2 = derivarCadencia([{ cadaDias: 45 }, { cadaDias: 30 }]);
  revisar("45 y 30 dan base 15 —el caso que produce ciclos vacíos—",
    d2.base === 15 && d2.actividades[0].cadaCuantas === 3 && d2.actividades[1].cadaCuantas === 2,
    `base ${d2.base}, múltiplos ${d2.actividades.map((a) => a.cadaCuantas).join(",")}`);

  const d3 = derivarCadencia([{ cadaDias: 0 }, { cadaDias: -5 }]);
  revisar("un cero o un negativo se sanea y se reporta, no se guarda",
    d3.ajustados.length === 2 && d3.actividades.every((a) => a.cadaCuantas >= 1));
  revisar("sin actividades no truena", derivarCadencia([]).base === 0);
  revisar("de vuelta a días para la pantalla", diasDe(6, 30) === 180);

  console.log("\nQué toca en cada ejecución");
  const act = [{ id: "aceite", cadaCuantas: 1 }, { id: "filtro", cadaCuantas: 3 }, { id: "frenos", cadaCuantas: 6 }];
  revisar("ejecución 1: solo el aceite", tocanEn(act, 1).map((a) => a.id).join(",") === "aceite");
  revisar("ejecución 3: aceite y filtro", tocanEn(act, 3).map((a) => a.id).join(",") === "aceite,filtro");
  revisar("ejecución 6: las TRES —el anidamiento—",
    tocanEn(act, 6).map((a) => a.id).join(",") === "aceite,filtro,frenos");
  revisar("ejecución 0 no toca nada", tocanEn(act, 0).length === 0);

  console.log("\nLa cadencia que se guarda sale de las frecuencias");
  const r1 = resolverCadenciaDelPlan(30, [{ cadaDias: null }, { cadaDias: 90 }, { cadaDias: 180 }]);
  revisar("plan mensual con actividades de 90 y 180: la base se queda en 30",
    r1.base === 30 && JSON.stringify(r1.multiplos) === "[1,3,6]",
    `base ${r1.base}, múltiplos ${r1.multiplos.join(",")}`);

  // El caso que hay que ENSEÑAR antes de guardar: la cadencia BAJA.
  const r2 = resolverCadenciaDelPlan(30, [{ cadaDias: 45 }]);
  revisar("una actividad cada 45 días en un plan mensual BAJA la base a 15",
    r2.base === 15 && r2.multiplos[0] === 3, `base ${r2.base}`);

  const r3 = resolverCadenciaDelPlan(null, [{ cadaDias: 90 }]);
  revisar("un plan por medidor no deriva nada y todo sale siempre",
    r3.base === null && r3.multiplos[0] === 1);

  const r4 = resolverCadenciaDelPlan(30, [{ cadaDias: null }, { cadaDias: null }]);
  revisar("sin frecuencias propias, la base no se mueve y todo es cada 1",
    r4.base === 30 && r4.multiplos.every((m) => m === 1));

  console.log("\nContra la base: un plan, tres frecuencias");
  const sello = `prueba-frec-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE" },
  });
  const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "PL", name: "Planta" } });
  const torno = await prisma.asset.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "TOR-1", name: "Torno", status: "OPERATIONAL" },
  });
  const especialidad = await prisma.specialty.create({
    data: { organizationId: org.id, code: "MEC", name: "Mecánico" },
  });

  // Base mensual: aceite cada 1, filtro cada 3, frenos cada 6.
  const plan = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Preventivo del torno", triggerType: "CALENDAR",
      intervalDays: 30, active: true, estimatedHours: 99,
      tasks: {
        create: [
          { position: 1, title: "Cambio de aceite", cadaCuantas: 1,
            labor: { create: { specialtyId: especialidad.id, personas: 1, hours: 1 } } },
          { position: 2, title: "Cambio de filtro", cadaCuantas: 3,
            labor: { create: { specialtyId: especialidad.id, personas: 1, hours: 2 } } },
          { position: 3, title: "Líquido de frenos", cadaCuantas: 6,
            labor: { create: { specialtyId: especialidad.id, personas: 2, hours: 2 } } },
        ],
      },
    },
  });
  const ayer = () => new Date(Date.now() - 86_400_000);
  await prisma.planAsset.create({
    data: { organizationId: org.id, planId: plan.id, assetId: torno.id, nextDueDate: ayer(), active: true },
  });

  // Seis ciclos seguidos. Entre uno y otro se vence la fecha a mano, que es lo
  // que haria el paso del tiempo.
  const ciclos: Array<{ n: number; actividades: string[]; horas: number }> = [];
  for (let i = 1; i <= 6; i++) {
    await generateScheduledWorkOrders(org.id);
    const ot = await prisma.workOrder.findFirst({
      where: { organizationId: org.id, planId: plan.id },
      orderBy: { createdAt: "desc" },
      select: { estimatedHours: true, tasks: { select: { title: true }, orderBy: { position: "asc" } } },
    });
    ciclos.push({
      n: i,
      actividades: (ot?.tasks ?? []).map((t) => t.title),
      horas: ot?.estimatedHours ?? 0,
    });
    // El programador no apila ordenes: si hay una abierta del mismo plan y
    // equipo, salta. Se cierra para que el siguiente ciclo pueda correr, que
    // es lo que haria el paso del tiempo con el tecnico haciendo su trabajo.
    await prisma.workOrder.updateMany({
      where: { organizationId: org.id, planId: plan.id, status: { notIn: ["COMPLETED"] } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await prisma.planAsset.updateMany({
      where: { organizationId: org.id, planId: plan.id }, data: { nextDueDate: ayer() },
    });
  }

  const nombres = (n: number) => ciclos[n - 1].actividades.join(" + ");
  revisar("ciclo 1: solo el aceite", nombres(1) === "Cambio de aceite", nombres(1));
  revisar("ciclo 3: aceite y filtro", nombres(3) === "Cambio de aceite + Cambio de filtro", nombres(3));
  revisar("ciclo 6: las tres, en UNA sola orden",
    nombres(6) === "Cambio de aceite + Cambio de filtro + Líquido de frenos", nombres(6));

  const ordenes = await prisma.workOrder.count({ where: { organizationId: org.id } });
  revisar("seis ciclos, seis órdenes —no una por actividad—", ordenes === 6, `${ordenes} órdenes`);

  console.log("\nLas horas estimadas son las de lo que entró");
  revisar("ciclo 1: 1 h, no las 99 del plan", ciclos[0].horas === 1, `${ciclos[0].horas} h`);
  revisar("ciclo 3: 3 h (aceite + filtro)", ciclos[2].horas === 3, `${ciclos[2].horas} h`);
  revisar("ciclo 6: 7 h (aceite + filtro + frenos con 2 personas)",
    ciclos[5].horas === 7, `${ciclos[5].horas} h`);

  console.log("\nArmar una orden a mano ofrece solo lo que toca");
  // La asignacion va en la ejecucion 6; la siguiente es la 7, donde solo toca
  // el aceite (cada 1). Ofrecer las tres invitaria a cambiar el aceite de mas
  // y a desalinear el calendario del resto.
  const antes = await prisma.planAsset.findFirst({
    where: { organizationId: org.id, planId: plan.id }, select: { ejecuciones: true },
  });
  const ofrece = await trabajoDisponible(org.id, torno.id);
  const delPlan = ofrece.planes.find((x) => x.planId === plan.id);
  revisar("ofrece solo la actividad que toca en la próxima ejecución",
    delPlan?.actividades.map((a) => a.title).join(",") === "Cambio de aceite",
    delPlan?.actividades.map((a) => a.title).join(",") ?? "(no ofreció el plan)");
  revisar("y el contador va en 6, así que la próxima es la 7",
    antes?.ejecuciones === 6, `ejecuciones: ${antes?.ejecuciones}`);

  console.log("\nLa proyección no promete visitas vacías");
  const proy = await forecastSchedule(org.id, 120);
  revisar("cada visita proyectada lleva al menos una actividad",
    proy.length > 0 && proy.every((e) => e.actividades > 0),
    `${proy.length} visitas proyectadas`);
  const delTorno = proy.filter((e) => e.planId === plan.id);
  revisar("y el número de actividades varía entre visitas",
    new Set(delTorno.map((e) => e.actividades)).size > 1,
    delTorno.map((e) => e.actividades).join(","));

  console.log("\nEl caso viejo sigue igual");
  const plano = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Plan de toda la vida", triggerType: "CALENDAR",
      intervalDays: 30, active: true, estimatedHours: 4,
      tasks: { create: [{ position: 1, title: "Una" }, { position: 2, title: "Otra" }] },
    },
  });
  await prisma.planAsset.create({
    data: { organizationId: org.id, planId: plano.id, assetId: torno.id, nextDueDate: ayer(), active: true },
  });
  await generateScheduledWorkOrders(org.id);
  const otVieja = await prisma.workOrder.findFirst({
    where: { organizationId: org.id, planId: plano.id },
    select: { estimatedHours: true, _count: { select: { tasks: true } } },
  });
  revisar("sin declarar frecuencias, salen TODAS las actividades",
    otVieja?._count.tasks === 2, `${otVieja?._count.tasks} actividades`);
  revisar("y sin mano de obra declarada, conserva el estimado del plan",
    otVieja?.estimatedHours === 4, `${otVieja?.estimatedHours} h`);

  console.log("\nUn ciclo vacío no emite orden, pero sí avanza");
  const raro = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Frecuencias que no encajan", triggerType: "CALENDAR",
      intervalDays: 15, active: true, estimatedHours: 1,
      // base 15: una cada 45 d (cada 3) y otra cada 30 d (cada 2). El ciclo 1
      // no toca ninguna.
      tasks: { create: [{ position: 1, title: "Cada 45", cadaCuantas: 3 }, { position: 2, title: "Cada 30", cadaCuantas: 2 }] },
    },
  });
  const bomba = await prisma.asset.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "BOM-1", name: "Bomba", status: "OPERATIONAL" },
  });
  await prisma.planAsset.create({
    data: { organizationId: org.id, planId: raro.id, assetId: bomba.id, nextDueDate: ayer(), active: true },
  });
  await generateScheduledWorkOrders(org.id);
  const delRaro = await prisma.workOrder.count({ where: { organizationId: org.id, planId: raro.id } });
  const asigRara = await prisma.planAsset.findFirst({
    where: { organizationId: org.id, planId: raro.id }, select: { ejecuciones: true },
  });
  revisar("el ciclo vacío NO generó orden", delRaro === 0, `${delRaro} órdenes`);
  revisar("pero el contador sí avanzó, o se atoraría para siempre",
    asigRara?.ejecuciones === 1, `ejecuciones: ${asigRara?.ejecuciones}`);

  console.log("\nCerrar tarde: desde el cierre o desde lo programado");
  // Tocaba hace 20 dias y se cierra hoy. Plan de 30 dias.
  const tocaba = new Date(Date.now() - 20 * 86_400_000);
  const planTarde = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Inspección mensual", triggerType: "CALENDAR",
      intervalDays: 30, active: true, estimatedHours: 1,
      tasks: { create: [{ position: 1, title: "Revisar" }] },
    },
  });
  const conAsignacion = async () => {
    await prisma.planAsset.deleteMany({ where: { planId: planTarde.id } });
    return prisma.planAsset.create({
      data: { organizationId: org.id, planId: planTarde.id, assetId: torno.id, nextDueDate: tocaba, active: true },
    });
  };
  const diasDesdeHoy = (d: Date | null) =>
    d ? Math.round((d.getTime() - Date.now()) / 86_400_000) : null;

  await prisma.organization.update({ where: { id: org.id }, data: { recalculoPlan: "CIERRE" } });
  await conAsignacion();
  await rollForwardPlan(planTarde.id, new Date(), null, torno.id);
  const aCierre = await prisma.planAsset.findFirst({
    where: { planId: planTarde.id }, select: { nextDueDate: true },
  });
  revisar("desde el CIERRE: el siguiente cae en 30 días, contados desde hoy",
    diasDesdeHoy(aCierre?.nextDueDate ?? null) === 30, `en ${diasDesdeHoy(aCierre?.nextDueDate ?? null)} días`);

  await prisma.organization.update({ where: { id: org.id }, data: { recalculoPlan: "PROGRAMADO" } });
  await conAsignacion();
  await rollForwardPlan(planTarde.id, new Date(), null, torno.id);
  const aProgramado = await prisma.planAsset.findFirst({
    where: { planId: planTarde.id }, select: { nextDueDate: true },
  });
  revisar("desde lo PROGRAMADO: cae en 10 días —el calendario no se recorre—",
    diasDesdeHoy(aProgramado?.nextDueDate ?? null) === 10,
    `en ${diasDesdeHoy(aProgramado?.nextDueDate ?? null)} días`);

  // Un cierre MUY tardio no puede dejar una fecha ya vencida.
  await prisma.planAsset.deleteMany({ where: { planId: planTarde.id } });
  await prisma.planAsset.create({
    data: { organizationId: org.id, planId: planTarde.id, assetId: torno.id,
      nextDueDate: new Date(Date.now() - 200 * 86_400_000), active: true },
  });
  await rollForwardPlan(planTarde.id, new Date(), null, torno.id);
  const muyTarde = await prisma.planAsset.findFirst({
    where: { planId: planTarde.id }, select: { nextDueDate: true },
  });
  revisar("y un cierre muy tardío NO deja un vencimiento que nace vencido",
    (diasDesdeHoy(muyTarde?.nextDueDate ?? null) ?? -1) > 0,
    `en ${diasDesdeHoy(muyTarde?.nextDueDate ?? null)} días`);
  await prisma.organization.update({ where: { id: org.id }, data: { recalculoPlan: "CIERRE" } });

  await prisma.workOrderTask.deleteMany({ where: { workOrder: { organizationId: org.id } } });
  await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
  await prisma.planAsset.deleteMany({ where: { organizationId: org.id } });
  await prisma.planTaskLabor.deleteMany({ where: { task: { plan: { organizationId: org.id } } } });
  await prisma.planTask.deleteMany({ where: { plan: { organizationId: org.id } } });
  await prisma.maintenancePlan.deleteMany({ where: { organizationId: org.id } });
  await prisma.specialty.deleteMany({ where: { organizationId: org.id } });
  await prisma.asset.deleteMany({ where: { organizationId: org.id } });
  await prisma.site.deleteMany({ where: { organizationId: org.id } });
  await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
