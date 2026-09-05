/**
 * El armador de ordenes: junta preventivo, reportes de falla y backlog en una
 * sola orden, y cada actividad conserva de donde vino.
 *
 *   npx tsx scripts/prueba-armador.ts
 */
import { prisma } from "../lib/db";
import { armarOrden, trabajoDisponible } from "../lib/armar-ot";

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
