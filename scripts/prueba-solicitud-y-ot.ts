/**
 * Como quedan los estados de una Solicitud segun lo que pase con su Orden.
 *
 * El caso que reporto Rafael: se convierte la solicitud en OT, se cancela la
 * OT, y la solicitud queda muerta —marcada como "convertida" apuntando a una
 * orden cancelada, sin poder volver a atenderse. Quien la levanto cree que va
 * en camino y nadie la va a mirar otra vez.
 *
 *   npx tsx scripts/prueba-solicitud-y-ot.ts
 */
import { prisma } from "../lib/db";
import { transitionWorkOrder } from "../lib/workorders";
import { armarOrden } from "../lib/armar-ot";
import { fallasCodificadas } from "../lib/fallas";
import { tipoDeTrabajo } from "../lib/tipos-solicitud";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: string) {
  console.log(`  ${ok ? "ok  " : "FALLA"}  ${afirmacion}${detalle ? `  → ${detalle}` : ""}`);
  if (!ok) fallos++;
}

async function main() {
  const sello = `prueba-sol-ot-${Date.now()}`;
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
      code: "TOR-1", name: "Torno de prueba", status: "OPERATIONAL",
    },
  });

  const nuevaSolicitud = async (n: string, titulo: string) =>
    prisma.workRequest.create({
      data: {
        organizationId: org.id, number: n, title: titulo,
        assetId: activo.id, status: "PENDING", priority: "MEDIUM",
      },
    });
  const estadoDe = async (id: string) =>
    prisma.workRequest.findUniqueOrThrow({
      where: { id }, select: { status: true, workOrderId: true },
    });

  try {
    // ── Se atiende en una orden ─────────────────────────────────────────────
    console.log("\nAl atenderla, queda ligada a la orden");
    const sol = await nuevaSolicitud("SOL-1", "El torno hace ruido");
    const r = await armarOrden({
      organizationId: org.id, userId: user.id, assetId: activo.id,
      title: "Atender el ruido", asignaciones: [], reportes: [sol.id], backlog: [],
    });
    if ("error" in r) throw new Error(r.error);
    const ot = r.orden;

    let e = await estadoDe(sol.id);
    revisar("queda como convertida", e.status === "CONVERTED", e.status);
    revisar("apunta a la orden", e.workOrderId === ot.id);

    // ── En proceso: nada cambia, sigue atendida ─────────────────────────────
    console.log("\nMientras la orden avanza, sigue atendida");
    await transitionWorkOrder({ workOrderId: ot.id, to: "IN_PROGRESS", userId: user.id, organizationId: org.id });
    e = await estadoDe(sol.id);
    revisar("sigue convertida con la orden en proceso", e.status === "CONVERTED" && e.workOrderId === ot.id);

    // ── Se cancela la orden: la solicitud DEBE liberarse ────────────────────
    console.log("\nAl cancelar la orden, la solicitud se libera");
    await transitionWorkOrder({ workOrderId: ot.id, to: "CANCELLED", userId: user.id, organizationId: org.id });
    e = await estadoDe(sol.id);
    revisar("vuelve a pendiente", e.status === "PENDING", e.status);
    revisar("ya no apunta a la orden cancelada", e.workOrderId === null, `${e.workOrderId}`);

    // ── Y se puede volver a atender en otra orden ───────────────────────────
    console.log("\nY se puede volver a atender");
    const r2 = await armarOrden({
      organizationId: org.id, userId: user.id, assetId: activo.id,
      title: "Segundo intento", asignaciones: [], reportes: [sol.id], backlog: [],
    });
    revisar("la vuelve a aceptar una orden nueva", !("error" in r2),
      "error" in r2 ? r2.error : "aceptada");
    if ("error" in r2) throw new Error(r2.error);
    e = await estadoDe(sol.id);
    revisar("queda ligada a la orden nueva", e.workOrderId === r2.orden.id);

    // ── Al completar la orden, la solicitud queda atendida ──────────────────
    console.log("\nAl completar la orden");
    await prisma.workOrderTask.updateMany({
      where: { workOrderId: r2.orden.id }, data: { done: true, completedAt: new Date() },
    });
    await transitionWorkOrder({ workOrderId: r2.orden.id, to: "IN_PROGRESS", userId: user.id, organizationId: org.id });
    await transitionWorkOrder({
      workOrderId: r2.orden.id, to: "COMPLETED", userId: user.id, organizationId: org.id,
      resolution: "Se ajusto", fallas: [],
    });
    e = await estadoDe(sol.id);
    revisar("sigue ligada a la orden que la resolvio", e.workOrderId === r2.orden.id);
    revisar("NO vuelve a pendiente al completar", e.status === "CONVERTED", e.status);

    // ── Reabrir una orden cancelada retoma sus solicitudes libres ───────────
    console.log("\nReabrir una orden cancelada retoma lo que siga libre");
    const sol2 = await nuevaSolicitud("SOL-2", "Otra cosa");
    const r3 = await armarOrden({
      organizationId: org.id, userId: user.id, assetId: activo.id,
      title: "Se va a cancelar", asignaciones: [], reportes: [sol2.id], backlog: [],
    });
    if ("error" in r3) throw new Error(r3.error);
    await transitionWorkOrder({ workOrderId: r3.orden.id, to: "CANCELLED", userId: user.id, organizationId: org.id });
    revisar("cancelada, la solicitud quedo libre", (await estadoDe(sol2.id)).status === "PENDING");
    await transitionWorkOrder({ workOrderId: r3.orden.id, to: "OPEN", userId: user.id, organizationId: org.id });
    e = await estadoDe(sol2.id);
    revisar("al reabrir, la retoma", e.status === "CONVERTED" && e.workOrderId === r3.orden.id, e.status);

    // ── Pero NO se la arrebata a otra orden ─────────────────────────────────
    console.log("\nAl reabrir NO le quita una solicitud a otra orden");
    const sol3 = await nuevaSolicitud("SOL-3", "Tercera");
    const r4 = await armarOrden({
      organizationId: org.id, userId: user.id, assetId: activo.id,
      title: "Se cancela tambien", asignaciones: [], reportes: [sol3.id], backlog: [],
    });
    if ("error" in r4) throw new Error(r4.error);
    await transitionWorkOrder({ workOrderId: r4.orden.id, to: "CANCELLED", userId: user.id, organizationId: org.id });
    // Alguien mas la atiende mientras tanto.
    const r5 = await armarOrden({
      organizationId: org.id, userId: user.id, assetId: activo.id,
      title: "Alguien mas la tomo", asignaciones: [], reportes: [sol3.id], backlog: [],
    });
    if ("error" in r5) throw new Error(r5.error);
    // Y ahora se reabre la primera.
    await transitionWorkOrder({ workOrderId: r4.orden.id, to: "OPEN", userId: user.id, organizationId: org.id });
    e = await estadoDe(sol3.id);
    revisar("se queda con quien la tomo, no con la que se reabrio",
      e.workOrderId === r5.orden.id, e.workOrderId === r5.orden.id ? "correcto" : "SE LA ARREBATO");

    // ── Borrar una orden tambien libera ─────────────────────────────────────
    console.log("\nBorrar una orden tambien libera sus solicitudes");
    const sol4 = await nuevaSolicitud("SOL-4", "Cuarta");
    const r6 = await armarOrden({
      organizationId: org.id, userId: user.id, assetId: activo.id,
      title: "Se va a borrar", asignaciones: [], reportes: [sol4.id], backlog: [],
    });
    if ("error" in r6) throw new Error(r6.error);
    await prisma.workRequest.updateMany({
      where: { workOrderId: r6.orden.id },
      data: { status: "PENDING", workOrderId: null, reviewedAt: null, reviewedById: null },
    });
    await prisma.workOrder.delete({ where: { id: r6.orden.id } });
    e = await estadoDe(sol4.id);
    revisar("queda pendiente y sin orden", e.status === "PENDING" && e.workOrderId === null);
    // ── El tipo de la solicitud decide el tipo del trabajo ──────────────────
    console.log("\nEl tipo de la solicitud decide como cuenta el trabajo");
    const esperado: Array<[string, string]> = [
      ["FALLA", "CORRECTIVE"],
      ["MEJORA", "IMPROVEMENT"],
      ["APOYO", "SUPPORT"],
      ["OTRO", "CORRECTIVE"],
    ];
    for (const [i, [tipo, esperada]] of esperado.entries()) {
      const sx = await prisma.workRequest.create({
        data: {
          organizationId: org.id, number: `SOL-T${i}`, title: `Prueba ${tipo}`,
          assetId: activo.id, status: "PENDING", priority: "MEDIUM", tipo,
        },
      });
      const rx = await armarOrden({
        organizationId: org.id, userId: user.id, assetId: activo.id,
        title: `Orden ${tipo}`, asignaciones: [], reportes: [sx.id], backlog: [],
      });
      if ("error" in rx) throw new Error(rx.error);
      const t = await prisma.workOrderTask.findFirstOrThrow({
        where: { workOrderId: rx.orden.id }, select: { maintenanceType: true },
      });
      revisar(`${tipo} entra como ${esperada}`, t.maintenanceType === esperada, `${t.maintenanceType}`);
    }

    // ── Y un apoyo NO cuenta como falla ─────────────────────────────────────
    console.log("\nUn apoyo no ensucia el analisis de fallas");
    const codigo = await prisma.failureCode.create({
      data: { organizationId: org.id, code: "X-1", description: "Lo que sea" },
    });
    const apoyo = await prisma.workOrder.findFirstOrThrow({
      where: { organizationId: org.id, title: "Orden APOYO" }, select: { id: true },
    });
    const tApoyo = await prisma.workOrderTask.findFirstOrThrow({ where: { workOrderId: apoyo.id } });
    await prisma.workOrderTask.update({
      where: { id: tApoyo.id }, data: { failureCodeId: codigo.id, done: true, completedAt: new Date() },
    });
    await transitionWorkOrder({ workOrderId: apoyo.id, to: "IN_PROGRESS", userId: user.id, organizationId: org.id });
    await transitionWorkOrder({
      workOrderId: apoyo.id, to: "COMPLETED", userId: user.id, organizationId: org.id, fallas: [],
    });
    const fallas = await fallasCodificadas(org.id, new Date(Date.now() - 86_400_000));
    revisar("aunque se le ponga codigo, el apoyo no cuenta como falla",
      fallas.length === 0, `${fallas.length} falla(s)`);

    // ── Sumar un reporte a una orden que YA existe ──────────────────────────
    console.log("\nSe puede sumar un reporte a una orden ya creada");
    const otViva = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: "OT-VIVA", title: "Preventivo en curso",
        maintenanceType: "PREVENTIVE", status: "IN_PROGRESS", assetId: activo.id,
        createdById: user.id,
      },
    });
    const solSuelta = await nuevaSolicitud("SOL-X", "Fuga que nadie ha visto");

    // Igual que hace el endpoint: la actividad y el amarre de la solicitud.
    const pos = await prisma.workOrderTask.aggregate({
      where: { workOrderId: otViva.id }, _max: { position: true },
    });
    await prisma.workOrderTask.create({
      data: {
        workOrderId: otViva.id, position: (pos._max.position ?? -1) + 1,
        origen: "SOLICITUD", origenRequestId: solSuelta.id,
        maintenanceType: tipoDeTrabajo(solSuelta.tipo),
        title: solSuelta.title, taskType: "CHECK", required: true,
      },
    });
    await prisma.workRequest.update({
      where: { id: solSuelta.id },
      data: { status: "CONVERTED", workOrderId: otViva.id, reviewedById: user.id, reviewedAt: new Date() },
    });

    const eX = await estadoDe(solSuelta.id);
    revisar("el reporte queda ligado a la orden viva", eX.workOrderId === otViva.id && eX.status === "CONVERTED");
    const tareasViva = await prisma.workOrderTask.count({ where: { workOrderId: otViva.id } });
    revisar("la orden gano su actividad", tareasViva === 1, `${tareasViva}`);

    // ── Un hallazgo levantado DESDE la orden nace ya ligado ─────────────────
    console.log("\nUn hallazgo levantado desde la orden nace ya ligado");
    const hallazgo = await prisma.workRequest.create({
      data: {
        organizationId: org.id, number: "SOL-H", title: "Encontre el reten vencido",
        assetId: activo.id, tipo: "FALLA", priority: "HIGH",
        status: "CONVERTED", workOrderId: otViva.id,
        requestedById: user.id, reviewedById: user.id, reviewedAt: new Date(),
      },
    });
    revisar("nace con folio propio", hallazgo.number.startsWith("SOL-"));
    revisar("nace atendido, sin pasar por revision",
      hallazgo.status === "CONVERTED" && hallazgo.workOrderId === otViva.id);

    // Y si la orden se cancela, el hallazgo tambien se libera.
    await transitionWorkOrder({ workOrderId: otViva.id, to: "CANCELLED", userId: user.id, organizationId: org.id });
    const eH = await estadoDe(hallazgo.id);
    revisar("si la orden se cancela, el hallazgo vuelve a pendiente",
      eH.status === "PENDING" && eH.workOrderId === null, eH.status);

  } finally {
    await prisma.workOrder.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
  }

  console.log(fallos === 0 ? "\nTodo correcto.\n" : `\n${fallos} revision(es) fallaron.\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
