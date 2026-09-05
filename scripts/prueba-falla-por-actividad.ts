/**
 * El caso que planteo Rafael: una OT que trae el preventivo del mes MAS dos
 * reportes de falla, y al cerrar cada falla conserva su propia causa.
 *
 * Prueba de punta a punta contra la base real de desarrollo. Crea su propia
 * organizacion, la ejercita y la borra al final.
 *
 *   npx tsx scripts/prueba-falla-por-actividad.ts
 */
import { prisma } from "../lib/db";
import { transitionWorkOrder, recalcWorkOrder } from "../lib/workorders";
import { fallasCodificadas, agruparPorCodigo } from "../lib/fallas";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const sello = `prueba-falla-${Date.now()}`;
  const org = await prisma.organization.create({
    data: { name: sello, slug: sello, plan: "ENTERPRISE" },
  });
  const user = await prisma.user.create({
    data: { organizationId: org.id, email: `${sello}@t.mx`, name: "Tecnico", role: "ADMIN", passwordHash: "x" },
  });
  const sitio = await prisma.site.create({
    data: { organization: { connect: { id: org.id } }, code: "PL-1", name: "Planta de prueba" },
  });
  const activo = await prisma.asset.create({
    data: {
      organization: { connect: { id: org.id } },
      site: { connect: { id: sitio.id } },
      code: "BMB-001", name: "Bomba de prueba", status: "OPERATIONAL",
    },
  });
  const codFuga = await prisma.failureCode.create({
    data: { organizationId: org.id, code: "MEC-01", description: "Fuga" },
  });
  const codRuido = await prisma.failureCode.create({
    data: { organizationId: org.id, code: "MEC-02", description: "Ruido anormal" },
  });
  const causaSello = await prisma.rootCause.create({
    data: { organizationId: org.id, code: "SELLO", description: "Sello vencido" },
  });

  try {
    // ── La OT preventiva del mes, con su rutina ──────────────────────────────
    const ot = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: "OT-1", title: "Preventivo mensual bomba",
        maintenanceType: "PREVENTIVE", status: "IN_PROGRESS", assetId: activo.id,
        createdById: user.id, startedAt: new Date(Date.now() - 3600_000),
      },
    });
    await prisma.workOrderTask.create({
      data: {
        workOrderId: ot.id, position: 0, origen: "PLAN", maintenanceType: "PREVENTIVE",
        title: "Cambiar filtro", done: true,
      },
    });

    // ── Dos reportes de falla, que se suman a ESA misma OT ───────────────────
    const reportes = [];
    for (const [i, titulo] of ["Fuga por el sello", "Ruido en el motor"].entries()) {
      const r = await prisma.workRequest.create({
        data: {
          organizationId: org.id, number: `SOL-${i + 1}`, title: titulo,
          assetId: activo.id, status: "PENDING",
        },
      });
      reportes.push(r);
      await prisma.workOrderTask.create({
        data: {
          workOrderId: ot.id, position: i + 1, origen: "SOLICITUD", origenRequestId: r.id,
          maintenanceType: "CORRECTIVE", title: titulo, done: true,
        },
      });
      await prisma.workRequest.update({
        where: { id: r.id }, data: { status: "CONVERTED", workOrderId: ot.id },
      });
    }

    console.log("\nUna OT con actividades de dos origenes");
    const tareas = await prisma.workOrderTask.findMany({ where: { workOrderId: ot.id }, orderBy: { position: "asc" } });
    revisar("la OT junta 3 actividades", tareas.length === 3, `${tareas.length}`);
    revisar("una viene del plan", tareas.filter((t) => t.origen === "PLAN").length === 1);
    revisar("dos vienen de reportes", tareas.filter((t) => t.origen === "SOLICITUD").length === 2);

    const ligadas = await prisma.workRequest.count({ where: { workOrderId: ot.id } });
    revisar("los DOS reportes apuntan a la misma OT", ligadas === 2, `${ligadas}`);

    // ── El cierre: una causa por cada falla ──────────────────────────────────
    const fuga = tareas.find((t) => t.title === "Fuga por el sello")!;
    const ruido = tareas.find((t) => t.title === "Ruido en el motor")!;
    await transitionWorkOrder({
      workOrderId: ot.id, to: "COMPLETED", userId: user.id, organizationId: org.id,
      resolution: "Se cambio filtro, sello y se ajusto el motor",
      fallas: [
        { taskId: fuga.id, failureCodeId: codFuga.id, rootCauseId: causaSello.id, downtimeMinutes: 30 },
        { taskId: ruido.id, failureCodeId: codRuido.id, rootCauseId: null, downtimeMinutes: 15 },
      ],
    });

    console.log("\nCada falla conserva su causa");
    const cerradas = await prisma.workOrderTask.findMany({ where: { workOrderId: ot.id }, orderBy: { position: "asc" } });
    const tFuga = cerradas.find((t) => t.id === fuga.id)!;
    const tRuido = cerradas.find((t) => t.id === ruido.id)!;
    const tPlan = cerradas.find((t) => t.origen === "PLAN")!;
    revisar("la fuga quedo con su codigo", tFuga.failureCodeId === codFuga.id);
    revisar("la fuga quedo con su causa", tFuga.rootCauseId === causaSello.id);
    revisar("el ruido quedo con OTRO codigo", tRuido.failureCodeId === codRuido.id);
    revisar("la actividad del plan NO tiene codigo", tPlan.failureCodeId === null);

    console.log("\nEl paro y su clasificacion");
    const paro = await prisma.downtimeEvent.findFirst({ where: { workOrderId: ot.id } });
    revisar("el paro suma los dos (30 + 15)", paro?.minutes === 45, `${paro?.minutes}`);
    revisar("NO se conto como paro planeado", paro?.planned === false, `planned=${paro?.planned}`);

    console.log("\nLo que ve el analisis");
    const fallas = await fallasCodificadas(org.id, new Date(Date.now() - 86_400_000));
    revisar("cuenta 2 eventos, no 1 ni 3", fallas.length === 2, `${fallas.length}`);
    revisar("ninguno viene del encabezado", fallas.every((f) => f.fuente === "ACTIVIDAD"));
    const pareto = agruparPorCodigo(fallas);
    revisar("el Pareto trae 2 codigos distintos", pareto.length === 2, `${pareto.length}`);
    revisar("el paro se reparte bien", pareto.every((p) => [30, 15].includes(p.minutosParo)));

    // ── El costo se atribuye a la actividad que lo causo ─────────────────────
    console.log("\nEl costo por actividad");
    // A la fuga: 2 h de mano de obra. Al ruido: un servicio externo.
    await prisma.workOrderLabor.create({
      data: { workOrderId: ot.id, userId: user.id, hours: 2, rate: 250, cost: 500, taskId: fuga.id },
    });
    await prisma.workOrderService.create({
      data: { workOrderId: ot.id, descripcion: "Rebobinado", quantity: 1, unitCost: 800, cost: 800, taskId: ruido.id },
    });
    // Y un gasto general, que no es de ninguna actividad: el viaje.
    await prisma.workOrderService.create({
      data: { workOrderId: ot.id, descripcion: "Viaje", quantity: 1, unitCost: 300, cost: 300 },
    });
    await recalcWorkOrder(ot.id);

    const conCosto = await prisma.workOrderTask.findMany({ where: { workOrderId: ot.id } });
    const cFuga = conCosto.find((t) => t.id === fuga.id)!;
    const cRuido = conCosto.find((t) => t.id === ruido.id)!;
    const cPlan = conCosto.find((t) => t.origen === "PLAN")!;
    revisar("la fuga costo 500", cFuga.totalCost === 500, `${cFuga.totalCost}`);
    revisar("el ruido costo 800", cRuido.totalCost === 800, `${cRuido.totalCost}`);
    revisar("la actividad del plan costo 0", cPlan.totalCost === 0, `${cPlan.totalCost}`);

    const otCosto = await prisma.workOrder.findUnique({ where: { id: ot.id }, select: { totalCost: true } });
    revisar("el total de la OT incluye el viaje (1600)", otCosto?.totalCost === 1600, `${otCosto?.totalCost}`);
    revisar(
      "la suma de actividades es menor que el total, y esta bien",
      cFuga.totalCost + cRuido.totalCost + cPlan.totalCost === 1300,
    );

    const conDinero = await fallasCodificadas(org.id, new Date(Date.now() - 86_400_000));
    const paretoCosto = agruparPorCodigo(conDinero);
    revisar(
      "el Pareto ordena por su propio costo, no por el de la orden",
      paretoCosto.every((x) => [500, 800].includes(x.costo)),
      paretoCosto.map((x) => x.costo).join(" / "),
    );

    // ── Una OT puramente preventiva no aporta fallas ─────────────────────────
    console.log("\nUn preventivo limpio no inventa fallas");
    const limpia = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: "OT-2", title: "Preventivo sin hallazgos",
        maintenanceType: "PREVENTIVE", status: "IN_PROGRESS", assetId: activo.id, createdById: user.id,
      },
    });
    await prisma.workOrderTask.create({
      data: { workOrderId: limpia.id, position: 0, origen: "PLAN", maintenanceType: "PREVENTIVE", title: "Revisar", done: true },
    });
    await transitionWorkOrder({
      workOrderId: limpia.id, to: "COMPLETED", userId: user.id, organizationId: org.id,
      resolution: "Todo en orden", fallas: [],
    });
    const despues = await fallasCodificadas(org.id, new Date(Date.now() - 86_400_000));
    revisar("sigue habiendo 2 eventos, no 3", despues.length === 2, `${despues.length}`);

    // ── Una orden vieja, con el codigo arriba, se sigue contando ─────────────
    console.log("\nLas ordenes viejas se siguen contando");
    const vieja = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: "OT-3", title: "Correctiva vieja",
        maintenanceType: "CORRECTIVE", status: "COMPLETED", assetId: activo.id, createdById: user.id,
        completedAt: new Date(), failureCodeId: codFuga.id, downtimeMinutes: 20,
      },
    });
    const conVieja = await fallasCodificadas(org.id, new Date(Date.now() - 86_400_000));
    revisar("ahora son 3", conVieja.length === 3, `${conVieja.length}`);
    revisar("una viene del encabezado", conVieja.filter((f) => f.fuente === "ENCABEZADO").length === 1);

    // ── Un preventivo viejo mal codificado NO debe contar ────────────────────
    await prisma.workOrder.update({
      where: { id: vieja.id },
      data: { maintenanceType: "PREVENTIVE" },
    });
    const sinElMalo = await fallasCodificadas(org.id, new Date(Date.now() - 86_400_000));
    revisar("un preventivo con codigo NO ensucia el Pareto", sinElMalo.length === 2, `${sinElMalo.length}`);
  } finally {
    // Las ordenes primero: sus cargos apuntan a usuarios, y esa llave no
    // cascadea desde la organizacion.
    await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }

  console.log(fallos === 0 ? "\nTodo correcto.\n" : `\n${fallos} revision(es) fallaron.\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
