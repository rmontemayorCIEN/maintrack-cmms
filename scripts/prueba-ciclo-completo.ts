/**
 * El ciclo completo: plan → equipos → orden → refacciones → cierre → costo →
 * siguiente ciclo.
 *
 * Las pruebas por pieza ya existen. Esta prueba la CADENA, que es donde vive
 * el riesgo: cada eslabon puede estar bien y la cadena estar rota. Es la parte
 * mas sensible del sistema —si un preventivo no se genera, o una refaccion no
 * llega al costo del equipo, el cliente pierde la confianza entera.
 */
import { PrismaClient } from "@prisma/client";
import { asignarPlan } from "../lib/asignaciones";
import { generateScheduledWorkOrders, forecastSchedule } from "../lib/scheduler";
import { transitionWorkOrder } from "../lib/workorders";
import { aplicarMovimiento } from "../lib/almacen";
import { backlog } from "../lib/backlog";

const prisma = new PrismaClient();
let fallas = 0;
const paso = (t: string) => console.log(`\n${t}\n`);
function revisar(e: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) fallas++;
  console.log(`  ${bien ? "ok   " : "FALLA"} ${e.padEnd(56)} ${JSON.stringify(real)}${bien ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
}
// La fecha se compara en hora LOCAL: el sistema la calcula asi (addDays usa
// setDate) y toISOString() es UTC, que corre el dia despues de las 18:00.
const iso = (d: Date | null | undefined) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : null;

/**
 * Vence un plan en un equipo, moviendo la palanca que de verdad manda.
 *
 * Desde el calendario por actividad, `PlanAsset.nextDueDate` es un DERIVADO
 * para las pantallas: quien decide si toca es el reloj de cada actividad. Una
 * prueba que solo mueve la fecha de la asignacion ya no vence nada, y pasaria
 * a probar un campo que nadie lee.
 */
async function vencer(assetIds: string[], planId: string, cuando: Date) {
  await prisma.planAsset.updateMany({
    where: { planId, assetId: { in: assetIds } },
    data: { nextDueDate: cuando },
  });
  await prisma.planTaskAsset.updateMany({
    where: { assetId: { in: assetIds }, planTask: { planId } },
    data: { proximaEl: cuando },
  });
}

async function main() {
  const suf = Date.now();
  const org = await prisma.organization.create({
    data: { name: "Ciclo", slug: `cc-${suf}`, horasJornada: 8, diasHabiles: "1,2,3,4,5" },
  });
  const site = await prisma.site.create({ data: { organizationId: org.id, code: "P1", name: "Planta" } });
  const alm = await prisma.warehouse.create({
    data: { organizationId: org.id, code: "GEN", name: "General", esGeneral: true },
  });
  const tecnico = await prisma.user.create({
    data: { organizationId: org.id, email: `t-${suf}@x.mx`, name: "Tecnico", passwordHash: "x", role: "TECHNICIAN", hourlyRate: 150 },
  });

  const compresores = await Promise.all(
    ["CMP-01", "CMP-02", "CMP-03"].map((code, i) =>
      prisma.asset.create({
        data: { organizationId: org.id, siteId: site.id, code, name: `Compresor ${code}`,
                criticality: i === 0 ? "A" : "B" },
      }),
    ),
  );

  const filtro = await prisma.part.create({
    data: { organizationId: org.id, code: "FIL-01", name: "Filtro de aire", unit: "pza", unitCost: 250 },
  });
  await aplicarMovimiento({
    organizationId: org.id, partId: filtro.id, warehouseId: alm.id,
    tipo: "IN", cantidad: 10, costoUnitario: 250, referencia: "compra inicial",
  });

  // ---------------------------------------------------------------
  paso("1 · UN PLAN PARA TRES COMPRESORES IGUALES");
  const plan = await prisma.maintenancePlan.create({
    data: {
      organizationId: org.id, name: "Preventivo mensual compresor",
      triggerType: "CALENDAR", intervalDays: 30, estimatedHours: 2, priority: "HIGH",
      tasks: {
        create: [
          {
            position: 0, title: "Cambiar filtro de aire", required: true, taskType: "REPLACE",
            // La refaccion cuelga de la ACTIVIDAD del plan, no del plan.
            parts: { create: [{ partId: filtro.id, quantity: 1 }] },
          },
          { position: 1, title: "Medir presion de descarga", required: true, taskType: "MEASURE", unit: "bar", minValue: 6, maxValue: 8 },
          { position: 2, title: "Revisar fugas", required: false, taskType: "CHECK" },
        ],
      },
    },
    include: { tasks: true },
  });
  revisar("un solo plan en el catalogo", await prisma.maintenancePlan.count({ where: { organizationId: org.id } }), 1);
  revisar("con tres actividades", plan.tasks.length, 3);

  const asign = await asignarPlan({
    organizationId: org.id, planId: plan.id,
    equipos: compresores.map((c) => ({ assetId: c.id })), escalonarAuto: true,
  });
  revisar("aplicado a los tres equipos", asign.creadas.length, 3);
  const asigs = await prisma.planAsset.findMany({
    where: { planId: plan.id }, include: { asset: true }, orderBy: { nextDueDate: "asc" },
  });
  revisar("cada uno con fecha propia", new Set(asigs.map((a) => iso(a.nextDueDate))).size, 3);
  console.log(`       ${asigs.map((a) => `${a.asset.code}:${iso(a.nextDueDate)}`).join("  ")}`);

  // ---------------------------------------------------------------
  paso("2 · EL CALENDARIO PROYECTA LOS TRES");
  const proy = await forecastSchedule(org.id, 120);
  const delPlan = proy.filter((e) => e.planId === plan.id);
  revisar("proyecta los tres equipos, no uno", new Set(delPlan.map((e) => e.asset)).size, 3);
  revisar("cada equipo con su propia fecha",
    new Set(delPlan.filter((e, i, a) => a.findIndex((x) => x.asset === e.asset) === i).map((e) => e.date.slice(0, 10))).size, 3);

  // ---------------------------------------------------------------
  paso("3 · EL PROGRAMADOR GENERA SOLO LO VENCIDO");
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  await vencer([asigs[0].assetId], plan.id, ayer);

  const gen = await generateScheduledWorkOrders(org.id, {});
  revisar("genera una sola orden", gen.generated, 1);
  const ot = await prisma.workOrder.findFirst({
    where: { organizationId: org.id }, include: { tasks: { orderBy: { position: "asc" } } },
  });
  revisar("para el equipo vencido", ot?.assetId, asigs[0].assetId);
  revisar("hereda las tres actividades", ot?.tasks.length, 3);
  revisar("cada actividad sabe de que plan vino",
    ot?.tasks.every((t) => t.origen === "PLAN" && t.origenPlanId === plan.id), true);
  revisar("y su tipo de mantenimiento", ot?.tasks[0].maintenanceType, "PREVENTIVE");
  revisar("los otros dos siguen esperando",
    await prisma.planAsset.count({ where: { planId: plan.id, lastGeneratedAt: null } }), 2);

  // ---------------------------------------------------------------
  paso("4 · LA REFACCION SALE DEL ALMACEN Y ENTRA AL COSTO");
  await aplicarMovimiento({
    organizationId: org.id, partId: filtro.id, warehouseId: alm.id,
    tipo: "OUT", cantidad: 1, workOrderId: ot!.id, referencia: "consumo del preventivo",
  });
  await prisma.workOrderPart.create({
    data: { workOrderId: ot!.id, partId: filtro.id, quantity: 1, unitCost: 250, cost: 250 },
  });
  await prisma.workOrderLabor.create({
    data: { workOrderId: ot!.id, userId: tecnico.id, hours: 2, rate: 150, cost: 300, workedAt: hoy },
  });
  const existencia = await prisma.part.findUnique({ where: { id: filtro.id }, select: { quantityOnHand: true } });
  revisar("la existencia bajo de 10 a 9", existencia?.quantityOnHand, 9);
  const kardex = await prisma.stockMovement.count({ where: { partId: filtro.id, workOrderId: ot!.id } });
  revisar("el kardex registra la salida contra la orden", kardex, 1);

  // ---------------------------------------------------------------
  paso("5 · SE CIERRA, Y SOLO AVANZA SU EQUIPO");
  await prisma.workOrderTask.updateMany({ where: { workOrderId: ot!.id }, data: { done: true } });
  const antes = await prisma.planAsset.findMany({
    where: { planId: plan.id }, select: { assetId: true, nextDueDate: true },
  });
  await transitionWorkOrder({ workOrderId: ot!.id, to: "IN_PROGRESS", userId: tecnico.id, organizationId: org.id });
  await transitionWorkOrder({ workOrderId: ot!.id, to: "COMPLETED", userId: tecnico.id, organizationId: org.id });

  const despues = await prisma.planAsset.findMany({
    where: { planId: plan.id }, select: { assetId: true, nextDueDate: true, lastCompletedAt: true },
  });
  const movidas = despues.filter((d) => iso(d.nextDueDate) !== iso(antes.find((a) => a.assetId === d.assetId)!.nextDueDate));
  revisar("solo se movio un equipo", movidas.length, 1);
  revisar("y fue el de la orden", movidas[0]?.assetId, asigs[0].assetId);
  revisar("avanzo 30 dias", iso(movidas[0]?.nextDueDate ?? null), iso(new Date(hoy.getTime() + 30 * 86_400_000)));

  const cerrada = await prisma.workOrder.findUnique({
    where: { id: ot!.id },
    select: { totalCost: true, partsCost: true, laborCost: true, actualHours: true, status: true },
  });
  revisar("la orden quedo completada", cerrada?.status, "COMPLETED");
  revisar("con el costo de la refaccion", cerrada?.partsCost, 250);
  revisar("y el de la mano de obra", cerrada?.laborCost, 300);
  revisar("sumando el total", cerrada?.totalCost, 550);
  revisar("y las horas reales", cerrada?.actualHours, 2);

  const equipo = await prisma.asset.findUnique({ where: { id: asigs[0].assetId }, select: { status: true } });
  revisar("el equipo volvio a operativo", equipo?.status, "OPERATIONAL");

  // ---------------------------------------------------------------
  paso("6 · EL SIGUIENTE CICLO");
  const gen2 = await generateScheduledWorkOrders(org.id, {});
  revisar("no vuelve a generar el que ya se hizo", gen2.generated, 0);
  const ot2 = await prisma.workOrder.count({ where: { organizationId: org.id } });
  revisar("sigue habiendo una sola orden", ot2, 1);

  await vencer([asigs[1].assetId, asigs[2].assetId], plan.id, ayer);
  const gen3 = await generateScheduledWorkOrders(org.id, {});
  revisar("ahora si genera los otros dos", gen3.generated, 2);
  revisar("tres ordenes en total", await prisma.workOrder.count({ where: { organizationId: org.id } }), 3);
  revisar("una por cada equipo",
    new Set((await prisma.workOrder.findMany({ where: { organizationId: org.id }, select: { assetId: true } })).map((o) => o.assetId)).size, 3);

  // ---------------------------------------------------------------
  paso("7 · LO QUE NO SE PUDO HACER NO SE PIERDE");
  const otB = await prisma.workOrder.findFirst({
    where: { organizationId: org.id, assetId: asigs[1].assetId },
    include: { tasks: true },
  });
  await prisma.workOrderTask.updateMany({
    where: { workOrderId: otB!.id, position: { in: [1, 2] } }, data: { done: true },
  });
  await prisma.workOrderTask.updateMany({
    where: { workOrderId: otB!.id, position: 0 },
    data: { liberadaAt: new Date(), liberadaPorId: tecnico.id, motivoLiberacion: "SIN_REFACCION", bloqueadaPorPartId: filtro.id },
  });
  await transitionWorkOrder({ workOrderId: otB!.id, to: "IN_PROGRESS", userId: tecnico.id, organizationId: org.id });
  await transitionWorkOrder({ workOrderId: otB!.id, to: "COMPLETED", userId: tecnico.id, organizationId: org.id });
  revisar("cierra aunque quede trabajo liberado",
    (await prisma.workOrder.findUnique({ where: { id: otB!.id }, select: { status: true } }))?.status, "COMPLETED");
  const pend = await backlog(org.id);
  revisar("lo liberado aparece en el pendiente", pend.length, 1);
  revisar("con su equipo", pend[0]?.workOrder.asset?.code, asigs[1].asset.code);
  revisar("y hay existencia, asi que ya se puede", pend[0]?.yaSePuede, true);
  revisar("el plan de ese equipo avanzo igual",
    (await prisma.planAsset.findFirst({ where: { planId: plan.id, assetId: asigs[1].assetId }, select: { lastCompletedAt: true } }))?.lastCompletedAt !== null, true);

  console.log(fallas ? `\n${fallas} revisiones fallaron\n` : "\nEl ciclo completo cuadra\n");
  process.exitCode = fallas ? 1 : 0;
}
main().catch((e) => { console.error("ERROR:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
