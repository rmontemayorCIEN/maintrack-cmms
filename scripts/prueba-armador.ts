/**
 * El armador de ordenes: junta preventivo, reportes de falla y backlog en una
 * sola orden, y cada actividad conserva de donde vino.
 *
 *   npx tsx scripts/prueba-armador.ts
 */
import { prisma } from "../lib/db";
import { armarOrden, trabajoDisponible } from "../lib/armar-ot";
import { transitionWorkOrder } from "../lib/workorders";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const sello = `prueba-armador-${Date.now()}`;
  const org = await prisma.organization.create({ data: { name: sello, slug: sello, plan: "ENTERPRISE" } });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}@t.mx`, name: "Sup", role: "ADMIN", passwordHash: "x" },
  });
  const sitio = await prisma.site.create({
    data: { organization: { connect: { id: org.id } }, code: "PL-1", name: "Planta" },
  });
  const activo = await prisma.asset.create({
    data: {
      organization: { connect: { id: org.id } }, site: { connect: { id: sitio.id } },
      code: "BMB-9", name: "Bomba nueve", status: "OPERATIONAL",
    },
  });

  try {
    // ── Un plan con dos actividades, asignado a ese equipo ───────────────────
    const plan = await prisma.maintenancePlan.create({
      data: {
        organizationId: org.id, name: "Preventivo mensual", maintenanceType: "PREVENTIVE",
        triggerType: "CALENDAR", intervalDays: 30, estimatedHours: 2, active: true,
        tasks: {
          create: [
            { position: 0, title: "Revisar sello", taskType: "CHECK", required: true },
            { position: 1, title: "Engrasar chumaceras", taskType: "CHECK", required: true },
          ],
        },
      },
    });
    await prisma.planAsset.create({
      data: {
        organizationId: org.id, planId: plan.id, assetId: activo.id, active: true,
        nextDueDate: new Date(Date.now() - 86_400_000),
      },
    });

    // ── Dos fallas reportadas ────────────────────────────────────────────────
    for (const [i, t] of ["Fuga por la brida", "Vibracion alta"].entries()) {
      await prisma.workRequest.create({
        data: {
          organizationId: org.id, number: `SOL-${i + 1}`, title: t,
          assetId: activo.id, status: "PENDING", priority: "HIGH",
        },
      });
    }

    // ── Y algo que quedo trabado la vez pasada ───────────────────────────────
    const otVieja = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: "OT-VIEJA", title: "Preventivo anterior",
        maintenanceType: "PREVENTIVE", status: "COMPLETED", assetId: activo.id,
        createdById: user.id, completedAt: new Date(),
      },
    });
    await prisma.workOrderTask.create({
      data: {
        workOrderId: otVieja.id, position: 0, origen: "PLAN", origenPlanId: plan.id,
        maintenanceType: "PREVENTIVE", title: "Cambiar balero",
        liberadaAt: new Date(Date.now() - 5 * 86_400_000),
        motivoLiberacion: "SIN_REFACCION",
      },
    });

    // ── Lo que el armador ofrece ─────────────────────────────────────────────
    console.log("\nLo que el armador ve del equipo");
    const d = await trabajoDisponible(org.id, activo.id);
    revisar("ofrece 1 plan", d.planes.length === 1, `${d.planes.length}`);
    revisar("el plan trae sus 2 actividades", d.planes[0]?.actividades.length === 2);
    revisar("marca que ya toca", d.planes[0]?.yaToca === true);
    revisar("ofrece los 2 reportes", d.reportes.length === 2, `${d.reportes.length}`);
    revisar("ofrece 1 pendiente del backlog", d.backlog.length === 1, `${d.backlog.length}`);
    revisar("dice de que orden venia", d.backlog[0]?.deLaOrden === "OT-VIEJA");

    // ── Armar la orden con TODO, llamando la funcion real ───────────────────
    const asignacion = await prisma.planAsset.findFirstOrThrow({ where: { planId: plan.id } });
    const reportesIds = d.reportes.map((r) => r.id);
    const backlogIds = d.backlog.map((b) => b.id);

    const r = await armarOrden({
      organizationId: org.id,
      userId: user.id,
      assetId: activo.id,
      title: "Todo junto en un viaje",
      asignaciones: [asignacion.id],
      reportes: reportesIds,
      backlog: backlogIds,
    });
    if ("error" in r) throw new Error(`No armo: ${r.error}`);
    const orden = r.orden;

    console.log("\nLa orden armada");
    const tareas = await prisma.workOrderTask.findMany({ where: { workOrderId: orden.id } });
    revisar("junta 5 actividades (2 plan + 2 reportes + 1 pendiente)", tareas.length === 5, `${tareas.length}`);
    revisar("3 son preventivas (2 del plan + 1 retomada)", tareas.filter((t) => t.maintenanceType === "PREVENTIVE").length === 3, `${tareas.filter((t) => t.maintenanceType === "PREVENTIVE").length}`);
    revisar("2 son correctivas", tareas.filter((t) => t.maintenanceType === "CORRECTIVE").length === 2);
    revisar("cada reporte quedo ligado a su actividad", tareas.filter((t) => t.origenRequestId).length === 2);
    revisar("el pendiente encadena con el original", tareas.some((t) => t.retomaDeTaskId === backlogIds[0]));

    // ── Al cerrar, TODOS los planes que aportaron deben avanzar ─────────────
    console.log("\nAl cerrar avanzan los planes que aportaron trabajo");
    const antesDe = await prisma.planAsset.findFirstOrThrow({
      where: { planId: plan.id, assetId: activo.id },
      select: { nextDueDate: true, lastCompletedAt: true },
    });
    // Se marcan las actividades como hechas: un plan no avanza por trabajo sin hacer.
    await prisma.workOrderTask.updateMany({
      where: { workOrderId: orden.id }, data: { done: true, completedAt: new Date() },
    });
    // Por los estados reales, no saltandoselos: OPEN → IN_PROGRESS → COMPLETED.
    await transitionWorkOrder({ workOrderId: orden.id, to: "IN_PROGRESS", userId: user.id, organizationId: org.id });
    await transitionWorkOrder({
      workOrderId: orden.id, to: "COMPLETED", userId: user.id, organizationId: org.id,
      resolution: "Todo hecho", fallas: [],
    });
    const despuesDe = await prisma.planAsset.findFirstOrThrow({
      where: { planId: plan.id, assetId: activo.id },
      select: { nextDueDate: true, lastCompletedAt: true },
    });
    revisar(
      "el plan avanzo aunque la OT no traiga planId en el encabezado",
      !!despuesDe.lastCompletedAt && despuesDe.nextDueDate?.getTime() !== antesDe.nextDueDate?.getTime(),
      `${antesDe.nextDueDate?.toISOString().slice(0,10)} → ${despuesDe.nextDueDate?.toISOString().slice(0,10)}`,
    );
    const enca = await prisma.workOrder.findUniqueOrThrow({ where: { id: orden.id }, select: { planId: true } });
    revisar("con un solo plan, el encabezado lo lleva", enca.planId === plan.id, `planId=${enca.planId ? "si" : "null"}`);

    // ── Dos planes en una orden: el encabezado no alcanza para ambos ─────────
    console.log("\nCon DOS planes, avanzan los dos");
    const plan2 = await prisma.maintenancePlan.create({
      data: {
        organizationId: org.id, name: "Inspeccion trimestral", maintenanceType: "INSPECTION",
        triggerType: "CALENDAR", intervalDays: 90, estimatedHours: 1, active: true,
        tasks: { create: [{ position: 0, title: "Termografia", taskType: "CHECK", required: true }] },
      },
    });
    const asig2 = await prisma.planAsset.create({
      data: {
        organizationId: org.id, planId: plan2.id, assetId: activo.id, active: true,
        nextDueDate: new Date(Date.now() - 86_400_000),
      },
    });
    const asig1 = await prisma.planAsset.findFirstOrThrow({ where: { planId: plan.id, assetId: activo.id } });
    const antes1 = asig1.nextDueDate, antes2 = asig2.nextDueDate;

    const r2 = await armarOrden({
      organizationId: org.id, userId: user.id, assetId: activo.id,
      title: "Los dos planes de un viaje",
      asignaciones: [asig1.id, asig2.id], reportes: [], backlog: [],
    });
    if ("error" in r2) throw new Error(`No armo: ${r2.error}`);

    const enca2 = await prisma.workOrder.findUniqueOrThrow({ where: { id: r2.orden.id }, select: { planId: true } });
    revisar("con dos planes el encabezado queda nulo, no miente", enca2.planId === null, `planId=${enca2.planId}`);

    await prisma.workOrderTask.updateMany({ where: { workOrderId: r2.orden.id }, data: { done: true, completedAt: new Date() } });
    await transitionWorkOrder({ workOrderId: r2.orden.id, to: "IN_PROGRESS", userId: user.id, organizationId: org.id });
    await transitionWorkOrder({
      workOrderId: r2.orden.id, to: "COMPLETED", userId: user.id, organizationId: org.id,
      resolution: "Los dos", fallas: [],
    });

    /**
     * Se comprueba contra el INTERVALO, no contra "cambio algo".
     *
     * Comparar antes/despues pasaba por una diferencia de horas aunque la
     * fecha fuera la misma: una prueba que se aprueba sola. Cada plan debe
     * quedar a su propio intervalo desde hoy —30 dias uno, 90 el otro— y esos
     * numeros distintos son la evidencia de que cada uno avanzo por su cuenta.
     */
    const d1 = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig1.id }, select: { nextDueDate: true, lastCompletedAt: true } });
    const d2 = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig2.id }, select: { nextDueDate: true, lastCompletedAt: true } });
    const diasDesdeHoy = (f: Date | null) =>
      f ? Math.round((f.getTime() - Date.now()) / 86_400_000) : null;
    const cerca = (n: number | null, esperado: number) => n !== null && Math.abs(n - esperado) <= 4;

    revisar("el plan de 30 dias quedo a ~30 dias", cerca(diasDesdeHoy(d1.nextDueDate), 30), `${diasDesdeHoy(d1.nextDueDate)} dias`);
    revisar("el plan de 90 dias quedo a ~90 dias", cerca(diasDesdeHoy(d2.nextDueDate), 90), `${diasDesdeHoy(d2.nextDueDate)} dias`);
    revisar("los dos registraron su ejecucion", !!d1.lastCompletedAt && !!d2.lastCompletedAt);
    void antes1; void antes2;

    // ── Los parametros de la organizacion mandan de verdad ──────────────────
    console.log("\nEl horizonte decide que planes se ofrecen");
    const plan3 = await prisma.maintenancePlan.create({
      data: {
        organizationId: org.id, name: "Anual lejano", maintenanceType: "PREVENTIVE",
        triggerType: "CALENDAR", intervalDays: 365, active: true,
        tasks: { create: [{ position: 0, title: "Algo", taskType: "CHECK", required: true }] },
      },
    });
    await prisma.planAsset.create({
      data: {
        organizationId: org.id, planId: plan3.id, assetId: activo.id, active: true,
        // Vence en 60 dias: dentro de un horizonte amplio, fuera de uno corto.
        nextDueDate: new Date(Date.now() + 60 * 86_400_000),
      },
    });

    await prisma.organization.update({ where: { id: org.id }, data: { otHorizonteDias: 0 } });
    const conCero = await trabajoDisponible(org.id, activo.id);
    revisar("con horizonte 0 no ofrece el que vence en 60 dias",
      !conCero.planes.some((x) => x.planId === plan3.id), `${conCero.planes.length} plan(es)`);

    await prisma.organization.update({ where: { id: org.id }, data: { otHorizonteDias: 90 } });
    const conNoventa = await trabajoDisponible(org.id, activo.id);
    revisar("con horizonte 90 si lo ofrece",
      conNoventa.planes.some((x) => x.planId === plan3.id), `${conNoventa.planes.length} plan(es)`);

    console.log("\nEl apagador de varios origenes se hace cumplir en el servidor");
    await prisma.organization.update({ where: { id: org.id }, data: { otMultiOrigen: false } });
    const nuevoReporte = await prisma.workRequest.create({
      data: {
        organizationId: org.id, number: "SOL-9", title: "Otra fuga",
        assetId: activo.id, status: "PENDING", priority: "MEDIUM",
      },
    });
    const asigPlan3 = await prisma.planAsset.findFirstOrThrow({ where: { planId: plan3.id } });
    const mezclado = await armarOrden({
      organizationId: org.id, userId: user.id, assetId: activo.id,
      title: "Mezcla no permitida",
      asignaciones: [asigPlan3.id], reportes: [nuevoReporte.id], backlog: [],
    });
    revisar("rechaza mezclar cuando esta apagado", "error" in mezclado,
      "error" in mezclado ? "rechazado" : "SE COLO");

    const unSoloOrigen = await armarOrden({
      organizationId: org.id, userId: user.id, assetId: activo.id,
      title: "Un solo origen si",
      asignaciones: [], reportes: [nuevoReporte.id], backlog: [],
    });
    revisar("pero un solo origen si pasa", !("error" in unSoloOrigen));

    await prisma.organization.update({ where: { id: org.id }, data: { otMultiOrigen: true } });

    console.log("\nEl backlog y los reportes ya no se ofrecen dos veces");
    const despues = await trabajoDisponible(org.id, activo.id);
    revisar("ya no hay reportes pendientes", despues.reportes.length === 0, `${despues.reportes.length}`);
    revisar("el pendiente salio del backlog", despues.backlog.length === 0, `${despues.backlog.length}`);

  } finally {
    await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }

  console.log(fallos === 0 ? "\nTodo correcto.\n" : `\n${fallos} revision(es) fallaron.\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
