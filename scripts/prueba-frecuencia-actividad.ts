/**
 * Frecuencia por actividad: los bordes que el ciclo basico no toca.
 *
 * Esta prueba cubria el mecanismo anterior —multiplos de una cadencia base— y
 * se reescribio cuando ese mecanismo se reemplazo por un calendario propio para
 * cada actividad. Los CASOS que cubria siguen siendo validos y son los de aqui;
 * lo que cambio es contra que se comprueban.
 *
 * El ciclo basico —una orden con lo que toca, cada reloj por su cuenta— vive en
 * `prueba-calendario-actividad.ts`. Aqui van los cinco bordes:
 *
 *   1. Las horas estimadas son las de lo que DE VERDAD entro.
 *   2. Armar una orden a mano ofrece —y guarda— solo lo que toca.
 *   3. La proyeccion promete las visitas que van a ocurrir, no una por actividad.
 *   4. Cerrar tarde: desde el cierre o desde lo programado.
 *   5. El caso viejo —un plan sin frecuencias por actividad— sigue igual.
 *
 *   npx tsx scripts/prueba-frecuencia-actividad.ts
 */
import { prisma } from "../lib/db";
import { asignarPlan } from "../lib/asignaciones";
import { armarOrden, trabajoDisponible } from "../lib/armar-ot";
import { generateScheduledWorkOrders, forecastSchedule } from "../lib/scheduler";
import { proyectarActividades, avanzarActividad } from "../lib/calendario-actividad";
import { startOfDay, addDays } from "../lib/utils";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

const HOY = startOfDay(new Date());
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

async function main() {
  const sello = `prueba-frec-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE", otHorizonteDias: 10 },
  });
  const sitio = await prisma.site.create({
    data: { organizationId: org.id, code: "PL", name: "Planta" },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: org.id, email: `${sello}@x.mx`, name: "Gestor",
      passwordHash: "x", role: "ADMIN",
    },
  });
  const especialidad = await prisma.specialty.create({
    data: { organizationId: org.id, code: "MEC", name: "Mecánico", hourlyRate: 150 },
  });
  const equipo = await prisma.asset.create({
    data: {
      organizationId: org.id, siteId: sitio.id, code: "BOM-500",
      name: "Bomba 500", status: "OPERATIONAL",
    },
  });

  // Tres ritmos que NO son multiplos entre si: con la cadencia base anterior
  // esto forzaba una base de un dia y 365 vueltas al ano.
  const plan = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Preventivo bomba", maintenanceType: "PREVENTIVE",
      triggerType: "CALENDAR", intervalDays: 7, estimatedHours: 99, active: true,
      leadTimeDays: 0, priority: "MEDIUM",
      tasks: {
        create: [
          { position: 0, title: "Revisar sellos", taskType: "CHECK", required: true, cadaCuanto: 1, unidadFrecuencia: "SEMANAS" },
          { position: 1, title: "Cambiar aceite", taskType: "CHECK", required: true, cadaCuanto: 15, unidadFrecuencia: "DIAS" },
          { position: 2, title: "Alinear flecha", taskType: "CHECK", required: true, cadaCuanto: 6, unidadFrecuencia: "MESES" },
        ],
      },
    },
    include: { tasks: { orderBy: { position: "asc" } } },
  });
  const [sellos, aceite, flecha] = plan.tasks;

  await prisma.planTaskLabor.createMany({
    data: [
      { planTaskId: sellos.id, specialtyId: especialidad.id, personas: 1, hours: 2 },
      { planTaskId: aceite.id, specialtyId: especialidad.id, personas: 2, hours: 3 },
      { planTaskId: flecha.id, specialtyId: especialidad.id, personas: 4, hours: 8 },
    ],
  });

  await asignarPlan({
    organizationId: org.id, planId: plan.id, userId: user.id,
    equipos: [{
      assetId: equipo.id,
      porActividad: [
        { planTaskId: sellos.id, fecha: HOY, esUltima: false },
        { planTaskId: aceite.id, fecha: addDays(HOY, 5), esUltima: false },
        { planTaskId: flecha.id, fecha: addDays(HOY, 120), esUltima: false },
      ],
    }],
  });

  // ── 1 ───────────────────────────────────────────────────────────────────
  console.log("\nLas horas estimadas son las de lo que DE VERDAD entró");
  const gen = await generateScheduledWorkOrders(org.id, { userId: user.id });
  const ot = await prisma.workOrder.findFirstOrThrow({
    where: { organizationId: org.id },
    include: { tasks: { select: { title: true } } },
  });
  const traidas = ot.tasks.map((t) => t.title).sort();
  revisar(
    "entran los sellos (hoy) y el aceite (en 5 d, dentro de la ventana de 10)",
    traidas.join(" + ") === "Cambiar aceite + Revisar sellos",
    traidas.join(" + "),
  );
  revisar("NO entra la alineación, que vence en 120 días", !traidas.includes("Alinear flecha"));
  revisar(
    "las horas son 2 + (2×3) = 8, no las 99 del plan ni las 40 de las tres",
    ot.estimatedHours === 8,
    `${ot.estimatedHours} h`,
  );
  revisar("y se generó una sola orden", gen.generated === 1, `${gen.generated}`);

  // ── 2 ───────────────────────────────────────────────────────────────────
  console.log("\nArmar una orden a mano ofrece —y guarda— solo lo que toca");
  await prisma.workOrderTask.deleteMany({ where: { workOrderId: ot.id } });
  await prisma.workOrder.delete({ where: { id: ot.id } });

  const disponible = await trabajoDisponible(org.id, equipo.id);
  const conFecha = disponible.planes[0]?.actividades ?? [];
  revisar(
    "ofrece las dos que tocan, no las tres del plan",
    conFecha.map((a) => a.title).sort().join(" + ") === "Cambiar aceite + Revisar sellos",
    conFecha.map((a) => a.title).join(" + ") || "(ninguna)",
  );
  revisar(
    "y cada una trae su propio vencimiento, no el del plan",
    new Set(conFecha.map((a) => iso(a.venceEl))).size === 2,
    conFecha.map((a) => `${a.title}:${a.faltan}d`).join(" · "),
  );

  const armada = await armarOrden({
    organizationId: org.id, userId: user.id, assetId: equipo.id,
    title: "A mano", actividades: conFecha.map((a) => a.id), reportes: [], backlog: [],
  });
  if ("error" in armada) throw new Error(armada.error);
  const guardadas = await prisma.workOrderTask.findMany({
    where: { workOrderId: armada.orden.id }, select: { title: true },
  });
  revisar(
    "guarda solo esas dos: la semestral no se cuela en cada orden manual",
    guardadas.map((t) => t.title).sort().join(" + ") === "Cambiar aceite + Revisar sellos",
    guardadas.map((t) => t.title).join(" + "),
  );

  // ── 3 ───────────────────────────────────────────────────────────────────
  console.log("\nLa proyección promete las visitas que van a ocurrir");
  const visitas = await proyectarActividades(org.id, 30);
  revisar("hay visitas proyectadas", visitas.length > 0, `${visitas.length}`);
  revisar("ninguna visita va vacía", visitas.every((v) => v.actividades.length > 0));
  revisar(
    "la primera junta los sellos y el aceite en UNA visita",
    visitas[0]?.actividades.length === 2,
    visitas[0]?.actividades.join(" + "),
  );
  const sueltas = visitas.reduce((n, v) => n + v.actividades.length, 0);
  revisar(
    "hay menos visitas que actividades sueltas: se agruparon",
    visitas.length < sueltas,
    `${visitas.length} visitas para ${sueltas} actividades`,
  );
  const eventos = await forecastSchedule(org.id, 30);
  revisar(
    "el calendario general muestra exactamente esas visitas",
    eventos.length === visitas.length,
    `${eventos.length} vs ${visitas.length}`,
  );
  revisar(
    "y cada evento dice QUÉ lleva, no solo cuántas cosas",
    eventos.every((e) => e.titulos.length === e.actividades),
    eventos[0]?.titulos.join(" · ") ?? "(sin títulos)",
  );

  // ── 4 ───────────────────────────────────────────────────────────────────
  console.log("\nCerrar tarde: desde el cierre o desde lo programado");
  const tarde = await prisma.planTask.create({
    data: {
      planId: plan.id, position: 3, title: "Mensual atrasada",
      taskType: "CHECK", required: true, cadaCuanto: 1, unidadFrecuencia: "MESES",
    },
  });
  const tocaba = addDays(HOY, -40);
  await prisma.planTaskAsset.create({
    data: {
      organizationId: org.id, planTaskId: tarde.id, assetId: equipo.id,
      arranqueEl: tocaba, arranqueEsUltima: false, proximaEl: tocaba,
    },
  });

  await prisma.organization.update({ where: { id: org.id }, data: { recalculoPlan: "CIERRE" } });
  const desdeCierre = await avanzarActividad({
    organizationId: org.id, planTaskId: tarde.id, assetId: equipo.id, completadaEl: HOY,
  });
  revisar(
    "CIERRE: cuenta desde que se hizo de verdad — un mes desde hoy",
    !!desdeCierre && desdeCierre.getDate() === HOY.getDate(),
    `cerrada el ${iso(HOY)}, siguiente ${iso(desdeCierre)}`,
  );

  await prisma.planTaskAsset.update({
    where: { planTaskId_assetId: { planTaskId: tarde.id, assetId: equipo.id } },
    data: { proximaEl: tocaba, ultimaEl: null },
  });
  await prisma.organization.update({ where: { id: org.id }, data: { recalculoPlan: "PROGRAMADO" } });
  const desdeProgramado = await avanzarActividad({
    organizationId: org.id, planTaskId: tarde.id, assetId: equipo.id, completadaEl: HOY,
  });
  revisar(
    "PROGRAMADO: sigue anclado al día del mes en que tocaba",
    !!desdeProgramado && desdeProgramado.getDate() === tocaba.getDate(),
    `tocaba día ${tocaba.getDate()}, siguiente ${iso(desdeProgramado)}`,
  );
  revisar(
    "y aun así no nace vencida: cae en el futuro",
    !!desdeProgramado && desdeProgramado > HOY,
    iso(desdeProgramado),
  );
  revisar(
    "las dos opciones dan fechas distintas —si no, el parámetro no serviría",
    iso(desdeCierre) !== iso(desdeProgramado),
    `${iso(desdeCierre)} vs ${iso(desdeProgramado)}`,
  );

  // ── 5 ───────────────────────────────────────────────────────────────────
  console.log("\nUn plan SIN frecuencias por actividad sigue funcionando igual");
  const viejo = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Plan de siempre", maintenanceType: "PREVENTIVE",
      triggerType: "CALENDAR", intervalDays: 30, estimatedHours: 3, active: true,
      leadTimeDays: 0, priority: "MEDIUM",
      tasks: {
        create: [
          { position: 0, title: "Revisión A", taskType: "CHECK", required: true },
          { position: 1, title: "Revisión B", taskType: "CHECK", required: true },
        ],
      },
    },
  });
  const equipoViejo = await prisma.asset.create({
    data: { organizationId: org.id, siteId: sitio.id, code: "BOM-501", name: "Bomba 501", status: "OPERATIONAL" },
  });
  // Asignada por la puerta de atras, como las 24 que ya existen en produccion.
  await prisma.planAsset.create({
    data: {
      organizationId: org.id, planId: viejo.id, assetId: equipoViejo.id,
      active: true, nextDueDate: addDays(HOY, -1),
    },
  });
  const genViejo = await generateScheduledWorkOrders(org.id, { userId: user.id });
  const otVieja = await prisma.workOrder.findFirst({
    where: { organizationId: org.id, assetId: equipoViejo.id },
    include: { tasks: { select: { title: true } } },
  });
  revisar("una asignación sin relojes NO se queda muda: se siembra sola", !!otVieja, `${genViejo.generated} generadas`);
  revisar("y trae sus DOS actividades, como siempre", (otVieja?.tasks.length ?? 0) === 2, `${otVieja?.tasks.length ?? 0}`);
  const relojesViejo = await prisma.planTaskAsset.findMany({
    where: { assetId: equipoViejo.id }, select: { proximaEl: true },
  });
  revisar(
    "y el calendario que el cliente ya conocía NO se movió",
    relojesViejo.length === 2 && relojesViejo.every((r) => iso(r.proximaEl) === iso(addDays(HOY, -1))),
    relojesViejo.map((r) => iso(r.proximaEl)).join(" · "),
  );

  console.log("\nUn múltiplo viejo NO se vuelve más frecuente al migrar");
  // El caso: multiplo 3 en un plan de 30 dias significaba cada 90. Si el
  // respaldo cayera al intervalo pelado del plan, pasaria a cada 30 —tres
  // veces mas seguido— sin un solo aviso, en cualquier plan que todavia no se
  // haya traducido.
  const trimestral = await prisma.planTask.create({
    data: {
      planId: viejo.id, position: 2, title: "Revisión C (era 1 de cada 3)",
      taskType: "CHECK", required: true, cadaCuantas: 3,
    },
  });
  await prisma.planTaskAsset.create({
    data: {
      organizationId: org.id, planTaskId: trimestral.id, assetId: equipoViejo.id,
      arranqueEl: HOY, arranqueEsUltima: true, proximaEl: null,
    },
  });
  const siguienteC = await avanzarActividad({
    organizationId: org.id, planTaskId: trimestral.id, assetId: equipoViejo.id, completadaEl: HOY,
  });
  const diasC = siguienteC ? Math.round((+siguienteC - +HOY) / 86_400_000) : 0;
  revisar(
    "sigue cayendo a ~90 días (3 × 30), no a los 30 del plan",
    diasC === 90,
    `${diasC} días`,
  );

  // ── Limpieza ────────────────────────────────────────────────────────────
  await prisma.workOrderTask.deleteMany({ where: { workOrder: { organizationId: org.id } } });
  await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
  await prisma.planTaskAsset.deleteMany({ where: { organizationId: org.id } });
  await prisma.planAsset.deleteMany({ where: { organizationId: org.id } });
  await prisma.planTaskLabor.deleteMany({ where: { task: { plan: { organizationId: org.id } } } });
  await prisma.planTask.deleteMany({ where: { plan: { organizationId: org.id } } });
  await prisma.maintenancePlan.deleteMany({ where: { organizationId: org.id } });
  await prisma.asset.deleteMany({ where: { organizationId: org.id } });
  await prisma.specialty.deleteMany({ where: { organizationId: org.id } });
  await prisma.site.deleteMany({ where: { organizationId: org.id } });
  await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
  await prisma.notification.deleteMany({ where: { organizationId: org.id } });
  await prisma.user.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(fallos ? `\n${fallos} fallas\n` : "\nTodo bien\n");
  process.exit(fallos ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
