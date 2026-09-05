/**
 * Un plan creado desde el formulario TIENE que generar ordenes.
 *
 * Esta es la prueba que faltaba. El defecto era silencioso: el plan se creaba,
 * aparecia en la lista con su fecha de vencimiento, se veia perfecto, y no
 * generaba una sola orden nunca —porque el programador itera PlanAsset y la
 * asignacion no se creaba. Nada avisaba.
 *
 *   npx tsx scripts/prueba-alta-de-plan.ts
 */
import { prisma } from "../lib/db";
import { altaDePlan } from "../lib/alta-de-plan";
import { generateScheduledWorkOrders } from "../lib/scheduler";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const sello = `prueba-alta-plan-${Date.now()}`;
  const org = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}@t.mx`, name: "Sup", role: "ADMIN", passwordHash: "x" },
  });
  const sitio = await prisma.site.create({
    data: { organization: { connect: { id: org.id } }, code: "PL", name: "Planta" },
  });
  const activo = await prisma.asset.create({
    data: {
      organization: { connect: { id: org.id } }, site: { connect: { id: sitio.id } },
      code: "EQ-1", name: "Equipo uno", status: "OPERATIONAL",
    },
  });

  try {
    // ── Por la MISMA funcion que usa el endpoint ────────────────────────────
    // Antes esta prueba creaba el plan y lo asignaba por su cuenta, o sea
    // replicaba al endpoint en vez de ejercitarlo. Por eso no detecto que el
    // endpoint nunca asignaba: la prueba hacia lo correcto mientras el sistema
    // hacia lo incorrecto, y las dos pasaban.
    const ayer = new Date(Date.now() - 86_400_000);
    const base = {
      maintenanceType: "PREVENTIVE", triggerType: "CALENDAR", intervalDays: 30,
      leadTimeDays: 3, toleranceDays: 2, priority: "MEDIUM", estimatedHours: 1,
      requiresShutdown: false, active: true,
      tasks: [{ title: "Revisar", taskType: "CHECK", required: true, parts: [], labor: [], services: [] }],
    };
    const alta = await altaDePlan(org.id, user.id, {
      ...base, name: "Preventivo de prueba",
      assetId: activo.id, nextDueDate: ayer.toISOString(),
    });
    if ("error" in alta) throw new Error(`No dio de alta: ${alta.error}`);
    const plan = alta.plan;

    console.log("\nLa asignacion se crea con el plan");
    const asignaciones = await prisma.planAsset.findMany({ where: { planId: plan.id } });
    revisar("el plan tiene su asignacion", asignaciones.length === 1, `${asignaciones.length}`);
    revisar("la asignacion apunta al equipo", asignaciones[0]?.assetId === activo.id);
    revisar("respeta la fecha que traia, no la reinicia", !!asignaciones[0]?.nextDueDate);

    console.log("\nY el programador SI lo genera");
    const r = await generateScheduledWorkOrders(org.id, { userId: user.id });
    const generadas = await prisma.workOrder.count({ where: { organizationId: org.id, planId: plan.id } });
    revisar("genero al menos una orden", generadas >= 1, `${generadas} orden(es)`);
    revisar("el programador lo reporta", r.generated >= 1, `generated=${r.generated}`);

    const ot = await prisma.workOrder.findFirst({
      where: { organizationId: org.id, planId: plan.id },
      include: { tasks: true },
    });
    revisar("la orden trae la actividad del plan", ot?.tasks.length === 1, `${ot?.tasks.length}`);
    revisar("la actividad sabe de que plan vino", ot?.tasks[0]?.origenPlanId === plan.id);

    // ── Un plan de catalogo, sin equipo, NO genera y esta bien ───────────────
    console.log("\nUn plan de catalogo sin asignar no genera, y es correcto");
    const altaCatalogo = await altaDePlan(org.id, user.id, {
      ...base, name: "Plan de catalogo", nextDueDate: ayer.toISOString(),
    });
    if ("error" in altaCatalogo) throw new Error(`No dio de alta: ${altaCatalogo.error}`);
    const catalogo = altaCatalogo.plan;
    const antes = await prisma.workOrder.count({ where: { organizationId: org.id } });
    await generateScheduledWorkOrders(org.id, { userId: user.id });
    const despues = await prisma.workOrder.count({ where: { organizationId: org.id } });
    revisar("no genero nada de mas", despues === antes, `${antes} → ${despues}`);
    revisar("y no tiene asignacion", (await prisma.planAsset.count({ where: { planId: catalogo.id } })) === 0);

    // ── El detector de huerfanos no debe encontrar nada ──────────────────────
    console.log("\nNo quedan planes que mientan");
    const huerfanosConEquipo = await prisma.maintenancePlan.count({
      where: { organizationId: org.id, active: true, asignaciones: { none: {} }, assetId: { not: null } },
    });
    revisar("ningun plan con equipo quedo sin asignacion", huerfanosConEquipo === 0, `${huerfanosConEquipo}`);
  } finally {
    await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }

  console.log(fallos === 0 ? "\nTodo correcto.\n" : `\n${fallos} revision(es) fallaron.\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
