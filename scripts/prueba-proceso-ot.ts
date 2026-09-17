/**
 * Bloque 1 — Integridad del proceso operativo: solicitudes, ordenes,
 * programacion, ejecucion y cierre.
 *
 * Llama a las MISMAS funciones que las rutas (`transitionWorkOrder`,
 * `aprobarSolicitud`, `rechazarSolicitud`, `consumePart`, `trabajoPendiente`,
 * `revisarProgramacion`, `saludDeDatos`), no a una copia de sus pasos.
 *
 *   npx tsx scripts/prueba-proceso-ot.ts
 */
import { prisma } from "../lib/db";
import { asegurarEditable, consumePart, ErrorDeOrden, recalcWorkOrder, transitionWorkOrder } from "../lib/workorders";
import { accionesDisponibles, faltantesDeCierre } from "../lib/reglas-ot";
import { aprobarSolicitud, rechazarSolicitud } from "../lib/solicitudes";
import { trabajoPendiente } from "../lib/backlog";
import { esReprogramacion, revisarProgramacion, validarDatosDeProgramacion } from "../lib/programacion";
import { saludDeDatos } from "../lib/salud-datos";
import { listaDeSaneamientoOt } from "../lib/saneamiento-ot";
import { can } from "../lib/rbac";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${typeof detalle === "string" ? detalle : JSON.stringify(detalle)}` : ""}`);
}

/** Espera un rechazo con ese codigo HTTP; devuelve el mensaje. */
async function rechaza(afirmacion: string, fn: () => Promise<unknown>, codigo: number, contiene?: string) {
  try {
    await fn();
    revisar(afirmacion, false, "no se rechazó");
    return "";
  } catch (e) {
    const c = (e as { codigo?: number }).codigo;
    const m = e instanceof Error ? e.message : String(e);
    revisar(afirmacion, c === codigo && (!contiene || m.includes(contiene)), `${c}: ${m}`);
    return m;
  }
}

const ZONA = "America/Monterrey";
const DIA = 86_400_000;

async function main() {
  const sello = `prueba-proceso-${Date.now()}`;
  const orgA = await prisma.organization.create({ data: { name: `${sello}-A`, slug: `${sello}-a`, plan: "ENTERPRISE", timezone: ZONA } });
  const orgB = await prisma.organization.create({ data: { name: `${sello}-B`, slug: `${sello}-b`, plan: "ENTERPRISE", timezone: ZONA } });
  const usuario = (org: string, rol: string, nombre: string, tarifa = 100) =>
    prisma.user.create({
      data: { organizationId: org, email: `${nombre}-${sello}@t.mx`, name: nombre, role: rol, passwordHash: "x", hourlyRate: tarifa },
    });

  try {
    const admin = await usuario(orgA.id, "ADMIN", "Admin");
    const sup = await usuario(orgA.id, "SUPERVISOR", "Supervisora");
    const tec = await usuario(orgA.id, "TECHNICIAN", "Tecnico", 150);
    const tec2 = await usuario(orgA.id, "TECHNICIAN", "Tecnica2", 200);
    const solicitante = await usuario(orgA.id, "REQUESTER", "Solicitante");
    const consulta = await usuario(orgA.id, "VIEWER", "Consulta");
    const ajeno = await usuario(orgB.id, "ADMIN", "AdminB");

    const sitio = await prisma.site.create({ data: { organizationId: orgA.id, code: "PL", name: "Planta" } });
    const activo = await prisma.asset.create({
      data: { organizationId: orgA.id, siteId: sitio.id, code: "CMP-1", name: "Compresor", status: "OPERATIONAL", criticality: "A" },
    });
    let folio = 0;
    const nuevaOt = (datos: Record<string, unknown> = {}) =>
      prisma.workOrder.create({
        data: {
          organizationId: orgA.id, number: `OT-P${++folio}`, title: `Orden ${folio}`, assetId: activo.id,
          maintenanceType: "PREVENTIVE", status: "OPEN", estimatedHours: 2,
          dueDate: new Date(Date.now() + 2 * DIA), ...datos,
        },
      });
    const horas = async (workOrderId: string, userId: string, h: number) => {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      await prisma.workOrderLabor.create({ data: { workOrderId, userId, hours: h, rate: u.hourlyRate, cost: h * u.hourlyRate } });
      await recalcWorkOrder(workOrderId);
    };
    const t = (workOrderId: string, to: string, rol: string, userId: string, extra: Record<string, unknown> = {}) =>
      transitionWorkOrder({ workOrderId, to, rol, userId, organizationId: orgA.id, ...extra });

    // ───────────────────────────────────────── 1. Transiciones de estado ───
    console.log("\n1. Transiciones de estado");
    const etiquetas = (status: string, rol: string, iniciada = true, conResponsable = true) =>
      accionesDisponibles({ status, iniciada, conResponsable }, rol).map((a) => a.etiqueta);
    revisar("una orden completada NO ofrece «Iniciar»", !etiquetas("COMPLETED", "ADMIN").includes("Iniciar"), etiquetas("COMPLETED", "ADMIN"));
    revisar("completada: el supervisor ve «Validar y cerrar» y «Devolver a proceso»",
      JSON.stringify(etiquetas("COMPLETED", "SUPERVISOR")) === JSON.stringify(["Validar y cerrar", "Devolver a proceso"]));
    revisar("completada: el técnico no ve acciones", etiquetas("COMPLETED", "TECHNICIAN").length === 0);
    revisar("cerrada: solo administración ve «Reabrir»", etiquetas("CLOSED", "ADMIN").includes("Reabrir") && etiquetas("CLOSED", "SUPERVISOR").length === 0);
    revisar("en proceso: el técnico ve «Pausar» y «Completar», no «Cancelar»",
      JSON.stringify(etiquetas("IN_PROGRESS", "TECHNICIAN")) === JSON.stringify(["Pausar", "Completar"]));
    revisar("consulta y solicitante no ven acciones", etiquetas("OPEN", "VIEWER").length === 0 && etiquetas("OPEN", "REQUESTER").length === 0);
    revisar("en espera sin iniciar: «Reanudar» regresa a asignada, no a en proceso",
      accionesDisponibles({ status: "ON_HOLD", iniciada: false, conResponsable: true }, "TECHNICIAN")[0]?.a === "ASSIGNED");

    const o1 = await nuevaOt();
    await rechaza("transición imposible (abierta → cerrada) se rechaza", () => t(o1.id, "CLOSED", "ADMIN", admin.id), 409);

    // ───────────────────────────────────────── 2. Solicitud → OT ───
    console.log("\n2. Conversión de solicitud a OT y duplicados");
    const solicitud = (n: string) => prisma.workRequest.create({
      data: {
        organizationId: orgA.id, number: n, title: `Fuga ${n}`, description: "Gotea aceite", assetId: activo.id,
        priority: "HIGH", requestedById: solicitante.id,
      },
    });
    const s1 = await solicitud("SS-P1");
    await prisma.attachment.create({ data: { organizationId: orgA.id, workRequestId: s1.id, name: "foto.jpg", storagePath: "x/foto.jpg", kind: "PHOTO" } });
    const r1 = await aprobarSolicitud({ organizationId: orgA.id, userId: sup.id, solicitudId: s1.id, tipo: "FALLA" });
    const s1d = await prisma.workRequest.findUniqueOrThrow({ where: { id: s1.id }, include: { _count: { select: { attachments: true } } } });
    const ot1 = await prisma.workOrder.findUniqueOrThrow({ where: { id: r1.workOrder.id }, include: { tasks: true } });
    revisar("la solicitud queda CONVERTED con su OT ligada", s1d.status === "CONVERTED" && s1d.workOrderId === ot1.id);
    revisar("conserva solicitante, activo, prioridad, descripción y evidencia",
      s1d.requestedById === solicitante.id && ot1.assetId === activo.id && ot1.priority === "HIGH" &&
      ot1.description === "Gotea aceite" && s1d._count.attachments === 1);
    revisar("la OT trae la actividad con su origen", ot1.tasks.some((x) => x.origenRequestId === s1.id));
    const aud = await prisma.auditLog.findFirst({ where: { entityId: s1.id, action: "CONVERTED" } });
    revisar("se registra quién la convirtió", s1d.reviewedById === sup.id && aud?.userId === sup.id);
    await rechaza("volver a convertirla se rechaza", () => aprobarSolicitud({ organizationId: orgA.id, userId: sup.id, solicitudId: s1.id }), 409);
    await rechaza("rechazar una ya convertida se rechaza", () => rechazarSolicitud({ organizationId: orgA.id, userId: sup.id, solicitudId: s1.id, motivo: "No procede" }), 409);

    const s2 = await solicitud("SS-P2");
    const antes = await prisma.workOrder.count({ where: { organizationId: orgA.id } });
    const dobles = await Promise.allSettled([
      aprobarSolicitud({ organizationId: orgA.id, userId: sup.id, solicitudId: s2.id }),
      aprobarSolicitud({ organizationId: orgA.id, userId: sup.id, solicitudId: s2.id }),
    ]);
    const despues = await prisma.workOrder.count({ where: { organizationId: orgA.id } });
    revisar("doble clic al convertir: una sola OT", despues - antes === 1 && dobles.filter((d) => d.status === "fulfilled").length === 1,
      dobles.map((d) => d.status === "fulfilled" ? "ok" : (d.reason as Error).message));

    const s3 = await solicitud("SS-P3");
    await rechaza("rechazar sin motivo se rechaza", () => rechazarSolicitud({ organizationId: orgA.id, userId: sup.id, solicitudId: s3.id, motivo: " " }), 422);
    await rechazarSolicitud({ organizationId: orgA.id, userId: sup.id, solicitudId: s3.id, motivo: "Es responsabilidad del proveedor" });
    const s3d = await prisma.workRequest.findUniqueOrThrow({ where: { id: s3.id } });
    revisar("rechazada con motivo y quién rechazó", s3d.status === "REJECTED" && s3d.reviewNotes === "Es responsabilidad del proveedor" && s3d.reviewedById === sup.id);
    revisar("el rechazo queda auditado", !!(await prisma.auditLog.findFirst({ where: { entityId: s3.id, action: "REJECTED", userId: sup.id } })));
    const cerradaDestino = await nuevaOt({ status: "CLOSED" });
    const s4 = await solicitud("SS-P4");
    await rechaza("sumar a una orden cerrada se rechaza", () => aprobarSolicitud({ organizationId: orgA.id, userId: sup.id, solicitudId: s4.id, workOrderId: cerradaDestino.id }), 409);
    revisar("y la solicitud sigue pendiente", (await prisma.workRequest.findUniqueOrThrow({ where: { id: s4.id } })).status === "PENDING");

    // ───────────────────────────────────────── 3. Asignación e inicio ───
    console.log("\n3. Asignación e inicio");
    const o3 = await nuevaOt();
    await rechaza("técnico no inicia una orden sin responsable sin tomarla", () => t(o3.id, "IN_PROGRESS", "TECHNICIAN", tec.id), 422);
    await rechaza("técnico no puede usar la excepción sin responsable", () => t(o3.id, "IN_PROGRESS", "TECHNICIAN", tec.id, { motivo: "Urgente sin asignar" }), 422);
    await t(o3.id, "IN_PROGRESS", "TECHNICIAN", tec.id, { tomarla: true });
    const o3d = await prisma.workOrder.findUniqueOrThrow({ where: { id: o3.id } });
    revisar("al tomarla queda como responsable y registra inicio real", o3d.assignedToId === tec.id && !!o3d.startedAt && o3d.responseMinutes !== null);
    const o3b = await nuevaOt();
    await t(o3b.id, "IN_PROGRESS", "SUPERVISOR", sup.id, { motivo: "Emergencia en turno nocturno" });
    const log3b = await prisma.auditLog.findFirst({ where: { entityId: o3b.id, action: "STATUS_CHANGED" } });
    revisar("supervisor inicia sin responsable solo con motivo, y queda en auditoría",
      JSON.parse(log3b!.changes).iniciadaSinResponsable === true && JSON.parse(log3b!.changes).motivo === "Emergencia en turno nocturno");

    // ───────────────────────────────────────── 4. Pausa y reprogramación ───
    console.log("\n4. Pausa y reprogramación");
    await rechaza("pausar sin motivo se rechaza", () => t(o3.id, "ON_HOLD", "TECHNICIAN", tec.id), 422);
    const inicio = o3d.startedAt!.getTime();
    await t(o3.id, "ON_HOLD", "TECHNICIAN", tec.id, { motivo: "Esperando refacción del proveedor" });
    const pausada = await prisma.workOrder.findUniqueOrThrow({ where: { id: o3.id }, include: { comments: true } });
    revisar("en espera guarda el motivo y lo deja a la vista en la bitácora",
      pausada.motivoEspera === "Esperando refacción del proveedor" && pausada.comments.some((c) => c.body.includes("Esperando refacción")));
    await t(o3.id, "IN_PROGRESS", "TECHNICIAN", tec.id);
    const reanudada = await prisma.workOrder.findUniqueOrThrow({ where: { id: o3.id } });
    revisar("reanudar limpia el motivo y conserva el inicio real", reanudada.motivoEspera === null && reanudada.startedAt!.getTime() === inicio);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    revisar("cambiar el día compromiso de una orden abierta es reprogramación (pide motivo)",
      esReprogramacion({ status: "OPEN", fechaAnterior: hoy, fechaNueva: new Date(hoy.getTime() + DIA) }));
    revisar("programar por primera vez o guardar el mismo día no lo es",
      !esReprogramacion({ status: "OPEN", fechaAnterior: null, fechaNueva: hoy }) &&
      !esReprogramacion({ status: "OPEN", fechaAnterior: hoy, fechaNueva: new Date(hoy.getTime() + 3_600_000) }));
    let invalida = false;
    try { validarDatosDeProgramacion({ estimatedHours: 0 }); } catch { invalida = true; }
    revisar("horas estimadas en cero se rechazan", invalida);

    // Sobrecarga: 7 h asignadas el proximo dia habil a Tecnico2 (jornada 8 h) y se quieren sumar 3.
    const habil = new Date(hoy);
    do { habil.setDate(habil.getDate() + 1); } while ([0, 6].includes(habil.getDay()));
    await nuevaOt({ assignedToId: tec2.id, status: "ASSIGNED", dueDate: habil, estimatedHours: 7 });
    const rev = await revisarProgramacion({ organizationId: orgA.id, fecha: habil, responsableId: tec2.id, horas: 3 });
    revisar("advierte la sobrecarga de la persona ese día", rev.advertencias.some((a) => a.includes("Tecnica2")), rev.advertencias);
    revisar("propone otros días con lugar y otras personas libres",
      rev.diasConCapacidad.length > 0 && rev.personasConCapacidad.some((p) => p.nombre === "Tecnico"), { dias: rev.diasConCapacidad, personas: rev.personasConCapacidad });
    const sabado = new Date(hoy);
    while (sabado.getDay() !== 6) sabado.setDate(sabado.getDate() + 1);
    const revSab = await revisarProgramacion({ organizationId: orgA.id, fecha: sabado, responsableId: tec.id, horas: 1 });
    revisar("advierte día no laborable", revSab.advertencias.some((a) => a.includes("no es día laborable")), revSab.advertencias);

    // ───────────────────────────────────────── 5. Horas, paro, checklist y cierre técnico ───
    console.log("\n5. Horas por técnico, paro, checklist y cierre técnico");
    const o5 = await nuevaOt({ maintenanceType: "CORRECTIVE", requiresShutdown: true, assignedToId: tec.id, status: "ASSIGNED" });
    const tarea = await prisma.workOrderTask.create({ data: { workOrderId: o5.id, title: "Cambiar sello", required: true, maintenanceType: "CORRECTIVE" } });
    const opcional = await prisma.workOrderTask.create({ data: { workOrderId: o5.id, title: "Limpiar área", required: false } });
    await t(o5.id, "IN_PROGRESS", "TECHNICIAN", tec.id);
    await horas(o5.id, tec.id, 2);
    await horas(o5.id, tec2.id, 1.5);
    const o5h = await prisma.workOrder.findUniqueOrThrow({ where: { id: o5.id } });
    revisar("horas por técnico: suma 3.5 h y costo con la tarifa de cada quien", o5h.actualHours === 3.5 && o5h.laborCost === 2 * 150 + 1.5 * 200, { h: o5h.actualHours, c: o5h.laborCost });

    const faltan = await rechaza("completar sin solución, diagnóstico, paro ni checklist se rechaza",
      () => t(o5.id, "COMPLETED", "TECHNICIAN", tec.id), 422);
    revisar("el rechazo nombra cada faltante",
      ["solución aplicada", "código de falla o causa raíz", "requería paro", "actividad(es) sin resolver"].every((x) => faltan.includes(x)), faltan);

    await prisma.workOrderTask.update({ where: { id: tarea.id }, data: { done: true } });
    // La opcional no se pudo hacer: se envia al backlog con motivo (lo que hace la ruta de liberar).
    await prisma.workOrderTask.update({
      where: { id: opcional.id },
      data: { liberadaAt: new Date(), liberadaPorId: tec.id, motivoLiberacion: "SIN_ACCESO", motivoDetalle: "Área ocupada por producción" },
    });
    const codigo = await prisma.failureCode.create({ data: { organizationId: orgA.id, code: "MEC-1", description: "Sello" } });
    const causa = await prisma.rootCause.create({ data: { organizationId: orgA.id, code: "DESG", description: "Desgaste" } });
    const conFallas = (min: number) => ({
      resolution: "Se cambió el sello",
      fallas: [{ taskId: tarea.id, failureCodeId: codigo.id, rootCauseId: null, downtimeMinutes: min }],
    });
    await rechaza("correctiva sin causa raíz ni justificación se rechaza", () => t(o5.id, "COMPLETED", "TECHNICIAN", tec.id, conFallas(90)), 422, "causa raíz");
    await rechaza("paro: minutos y «no hubo paro» a la vez se rechaza",
      () => t(o5.id, "COMPLETED", "TECHNICIAN", tec.id, { ...conFallas(90), motivoSinDiagnostico: "No se encontró la causa", sinParoConfirmado: true }), 422, "deje solo uno");
    await t(o5.id, "COMPLETED", "TECHNICIAN", tec.id, { ...conFallas(90), motivoSinDiagnostico: "No se encontró la causa todavía" });
    const o5c = await prisma.workOrder.findUniqueOrThrow({ where: { id: o5.id }, include: { downtimes: true } });
    revisar("completa con causa «Sin determinar» justificada y registra el paro de 90 min",
      o5c.status === "COMPLETED" && o5c.motivoSinDiagnostico === "No se encontró la causa todavía" &&
      o5c.downtimes.length === 1 && o5c.downtimes[0].minutes === 90 && !!o5c.completedAt);

    const o5b = await nuevaOt({ requiresShutdown: true, assignedToId: tec.id, status: "IN_PROGRESS", startedAt: new Date() });
    await t(o5b.id, "COMPLETED", "TECHNICIAN", tec.id, { resolution: "Inspección sin hallazgos", sinParoConfirmado: true, motivoSinHoras: "Lo hizo el contratista; va en servicios" });
    const o5bc = await prisma.workOrder.findUniqueOrThrow({ where: { id: o5b.id }, include: { downtimes: true } });
    revisar("sin horas con excepción justificada y «no hubo paro» confirmado: completa sin inventar paro",
      o5bc.status === "COMPLETED" && o5bc.sinParoConfirmado && o5bc.downtimes.length === 0 && o5bc.motivoSinHoras !== null);
    const o5d = await nuevaOt({ assignedToId: tec.id, status: "IN_PROGRESS", startedAt: new Date() });
    await t(o5d.id, "COMPLETED", "TECHNICIAN", tec.id, { resolution: "Ajuste menor sin checklist", motivoSinHoras: "Menos de 10 minutos" });
    revisar("una orden sin checklist se completa (no se obliga a crear actividades)",
      (await prisma.workOrder.findUniqueOrThrow({ where: { id: o5d.id } })).status === "COMPLETED");

    await prisma.organization.update({ where: { id: orgA.id }, data: { otEvidenciaCriticas: true } });
    const o5e = await nuevaOt({ assignedToId: tec.id, status: "IN_PROGRESS", startedAt: new Date() });
    await horas(o5e.id, tec.id, 1);
    await rechaza("equipo crítico con evidencia obligatoria: sin archivo no completa",
      () => t(o5e.id, "COMPLETED", "TECHNICIAN", tec.id, { resolution: "Cambio de filtro" }), 422, "evidencia");
    await prisma.organization.update({ where: { id: orgA.id }, data: { otEvidenciaCriticas: false } });
    revisar("con la opción apagada, la evidencia no se pide",
      faltantesDeCierre({ resolucion: "Cambio de filtro", horas: 1, motivoSinHoras: null, requiereParo: false, minutosParo: 0, sinParoConfirmado: false, fallas: [], motivoSinDiagnostico: null, actividadesSinResolver: 0, evidenciaRequerida: false, archivos: 0 }).length === 0);

    // ───────────────────────────────────────── 6. Backlog ───
    console.log("\n6. Actividades no realizadas y backlog");
    const vencida = await nuevaOt({ dueDate: new Date(Date.now() - 5 * DIA), assignedToId: tec.id, status: "ASSIGNED" });
    const enEspera = await nuevaOt({ assignedToId: tec.id, status: "ASSIGNED", dueDate: new Date(Date.now() - 9 * DIA) });
    await t(enEspera.id, "ON_HOLD", "TECHNICIAN", tec.id, { motivo: "Sin acceso al techo" });
    const pend = await trabajoPendiente(orgA.id, { zona: ZONA });
    const act = pend.find((p) => p.id === opcional.id);
    revisar("la actividad no realizada aparece como ACTIVIDAD_LIBERADA con motivo y próxima acción",
      act?.categoria === "ACTIVIDAD_LIBERADA" && act.motivo.includes("Área ocupada") && act.proximaAccion.includes("acceso") && act.orden.number === o5.number, act);
    revisar("la orden en espera cae en EN_ESPERA con su motivo",
      pend.find((p) => p.id === enEspera.id)?.categoria === "EN_ESPERA" && pend.find((p) => p.id === enEspera.id)?.motivo === "Sin acceso al techo");
    revisar("la vencida cae en VENCIDA y la sin responsable en SIN_RESPONSABLE",
      pend.find((p) => p.id === vencida.id)?.categoria === "VENCIDA" && pend.find((p) => p.id === o1.id)?.categoria === "SIN_RESPONSABLE");
    revisar("cada renglón trae origen, activo, prioridad, horas, antigüedad y próxima acción",
      pend.every((p) => p.origen && p.prioridad && p.proximaAccion && typeof p.antiguedadDias === "number" && (p.horas === null || p.horas > 0)));
    revisar("una orden aparece una sola vez aunque esté vencida y sin responsable",
      new Set(pend.map((p) => p.id)).size === pend.length);

    // ───────────────────────────────────────── 7. Cierre administrativo y reapertura ───
    console.log("\n7. Cierre administrativo, cambios en cerrada y reapertura");
    await rechaza("el técnico no puede cerrar", () => t(o5.id, "CLOSED", "TECHNICIAN", tec.id), 403);
    await t(o5.id, "CLOSED", "SUPERVISOR", sup.id);
    const cerrada = await prisma.workOrder.findUniqueOrThrow({ where: { id: o5.id } });
    revisar("el supervisor valida y cierra", cerrada.status === "CLOSED" && !!cerrada.closedAt);
    let bloqueada = false;
    try { asegurarEditable(cerrada); } catch (e) { bloqueada = e instanceof ErrorDeOrden && e.codigo === 409; }
    revisar("cerrada no acepta horas, actividades ni costos sin reabrir", bloqueada);
    const parte = await prisma.part.create({ data: { organizationId: orgA.id, code: "SEL-1", name: "Sello", unitCost: 50, quantityOnHand: 10 } });
    await prisma.warehouse.create({ data: { organizationId: orgA.id, code: "GEN", name: "General", esGeneral: true } });
    await rechaza("tampoco acepta refacciones", () => consumePart({ organizationId: orgA.id, workOrderId: o5.id, partId: parte.id, quantity: 1, userId: tec.id }), 409);

    await rechaza("el supervisor no puede reabrir una cerrada", () => t(o5.id, "COMPLETED", "SUPERVISOR", sup.id, { motivo: "Faltó una refacción" }), 403);
    await rechaza("administración sin motivo no la reabre", () => t(o5.id, "COMPLETED", "ADMIN", admin.id), 422);
    await t(o5.id, "COMPLETED", "ADMIN", admin.id, { motivo: "Faltó cargar una refacción" });
    const reabierta = await prisma.workOrder.findUniqueOrThrow({ where: { id: o5.id }, include: { downtimes: true } });
    revisar("reabrir regresa a Completada, borra el cierre y conserva la fecha de término",
      reabierta.status === "COMPLETED" && reabierta.closedAt === null && reabierta.completedAt?.getTime() === o5c.completedAt?.getTime());
    revisar("reabrir no repite efectos del completado (un solo evento de paro)", reabierta.downtimes.length === 1);
    const logReabre = await prisma.auditLog.findFirst({ where: { entityId: o5.id, action: "STATUS_CHANGED", userId: admin.id } });
    revisar("la transición registra usuario, estados y motivo",
      !!logReabre && JSON.parse(logReabre.changes).from === "CLOSED" && JSON.parse(logReabre.changes).to === "COMPLETED" && JSON.parse(logReabre.changes).motivo === "Faltó cargar una refacción");
    await t(o5.id, "IN_PROGRESS", "SUPERVISOR", sup.id, { motivo: "Revisar de nuevo la fuga" });
    const devuelta = await prisma.workOrder.findUniqueOrThrow({ where: { id: o5.id } });
    revisar("devolver a proceso borra la fecha de término (deja de contar como terminada)", devuelta.status === "IN_PROGRESS" && devuelta.completedAt === null);

    // ───────────────────────────────────────── 8. Permisos ───
    console.log("\n8. Permisos");
    const o8 = await nuevaOt({ assignedToId: tec.id, status: "ASSIGNED" });
    await rechaza("solicitante no puede iniciar", () => t(o8.id, "IN_PROGRESS", "REQUESTER", solicitante.id), 403);
    await rechaza("consulta no puede iniciar", () => t(o8.id, "IN_PROGRESS", "VIEWER", consulta.id), 403);
    await rechaza("técnico no puede cancelar", () => t(o8.id, "CANCELLED", "TECHNICIAN", tec.id, { motivo: "No hace falta" }), 403);
    await rechaza("cancelar sin motivo se rechaza", () => t(o8.id, "CANCELLED", "SUPERVISOR", sup.id), 422);
    await t(o8.id, "CANCELLED", "SUPERVISOR", sup.id, { motivo: "Duplicada de OT-P1" });
    revisar("cancelada con motivo guardado", (await prisma.workOrder.findUniqueOrThrow({ where: { id: o8.id } })).motivoCancelacion === "Duplicada de OT-P1");
    revisar("matriz: solo propietario y administración reabren; solicitante crea solicitudes y no ejecuta",
      can("OWNER", "workorder:reopen") && can("ADMIN", "workorder:reopen") && !can("SUPERVISOR", "workorder:reopen") &&
      can("REQUESTER", "request:create") && !can("REQUESTER", "workorder:execute") && !can("VIEWER", "request:create"));

    // ───────────────────────────────────────── 9. Doble clic ───
    console.log("\n9. Doble clic o reintento");
    const o9 = await nuevaOt({ assignedToId: tec.id, status: "IN_PROGRESS", startedAt: new Date(), requiresShutdown: true });
    await horas(o9.id, tec.id, 1);
    const cierre9 = { resolution: "Ajuste", downtimeMinutes: 30 };
    const dos = await Promise.allSettled([
      t(o9.id, "COMPLETED", "TECHNICIAN", tec.id, cierre9),
      t(o9.id, "COMPLETED", "TECHNICIAN", tec.id, cierre9),
    ]);
    const o9d = await prisma.workOrder.findUniqueOrThrow({ where: { id: o9.id }, include: { downtimes: true } });
    const logs9 = await prisma.auditLog.count({ where: { entityId: o9.id, action: "STATUS_CHANGED", summary: { contains: "→ COMPLETED" } } });
    revisar("dos completados simultáneos: un solo paro y una sola transición auditada",
      o9d.status === "COMPLETED" && o9d.downtimes.length === 1 && logs9 === 1,
      { resultados: dos.map((d) => d.status), paros: o9d.downtimes.length, logs: logs9 });
    const repetido = await t(o9.id, "COMPLETED", "TECHNICIAN", tec.id, cierre9);
    revisar("un reintento posterior no falla ni repite nada", repetido.status === "COMPLETED" &&
      (await prisma.downtimeEvent.count({ where: { workOrderId: o9.id } })) === 1);

    // ───────────────────────────────────────── 10. Aislamiento ───
    console.log("\n10. Aislamiento por organización");
    await rechaza("otra empresa no puede mover la orden", () => transitionWorkOrder({ workOrderId: o1.id, to: "IN_PROGRESS", rol: "ADMIN", userId: ajeno.id, organizationId: orgB.id, tomarla: true }), 404);
    const s5 = await solicitud("SS-P5");
    await rechaza("otra empresa no puede convertir la solicitud", () => aprobarSolicitud({ organizationId: orgB.id, userId: ajeno.id, solicitudId: s5.id }), 404);
    const parteB = await prisma.part.create({ data: { organizationId: orgB.id, code: "X", name: "X", unitCost: 1, quantityOnHand: 5 } });
    await prisma.warehouse.create({ data: { organizationId: orgB.id, code: "GEN", name: "General", esGeneral: true } });
    await rechaza("otra empresa no puede cargar refacciones a una orden ajena",
      () => consumePart({ organizationId: orgB.id, workOrderId: o3.id, partId: parteB.id, quantity: 1, userId: ajeno.id }), 404);
    revisar("y no se creó ningún cargo en la orden", (await prisma.workOrderPart.count({ where: { workOrderId: o3.id } })) === 0);
    revisar("el backlog de otra empresa no ve estas órdenes", (await trabajoPendiente(orgB.id, { zona: ZONA })).length === 0);

    // ───────────────────────────────────────── 11. Calidad de captura ───
    console.log("\n11. Calidad de captura");
    // 20 preventivas cerradas; 3 sin horas (15 %) y una sin horas pero justificada.
    for (let i = 0; i < 20; i++) {
      const o = await nuevaOt({ status: "CLOSED", completedAt: new Date(), closedAt: new Date(), assignedToId: tec.id, resolution: "Hecho" });
      if (i >= 4) await horas(o.id, tec.id, 1);
      if (i === 3) await prisma.workOrder.update({ where: { id: o.id }, data: { motivoSinHoras: "Lo hizo el proveedor" } });
    }
    const salud = await saludDeDatos(orgA.id);
    const sinHoras = salud.revisiones.find((r) => r.clave === "ot-sin-horas")!;
    revisar("la excepción justificada no cuenta como orden sin horas", sinHoras.hallazgos.every((h) => !h.etiqueta.includes("Lo hizo")));
    const pct = sinHoras.porcentaje;
    revisar("una regla crítica se penaliza el triple (no es «casi perfecta»)",
      sinHoras.critica && Math.round(sinHoras.calificacion) === Math.max(0, Math.round(100 - 3 * (100 - (sinHoras.cumplidos / sinHoras.total) * 100))) && sinHoras.calificacion < pct,
      { total: sinHoras.total, sinHoras: sinHoras.total - sinHoras.cumplidos, porcentaje: pct, calificacion: sinHoras.calificacion });
    const reglas = new Map(salud.revisiones.map((r) => [r.clave, r]));
    revisar("penaliza activas sin responsable, solicitudes sin OT y actividades sin resolver",
      ["activas-sin-responsable", "solicitudes-sin-ot", "actividades-sin-resolver", "fallas-sin-diagnostico", "paro-sin-duracion"].every((c) => reglas.get(c)?.critica));
    // Solicitud marcada como convertida sin orden (dato historico).
    await prisma.workRequest.create({ data: { organizationId: orgA.id, number: "SS-HUERF", title: "Huérfana", status: "CONVERTED" } });
    const lista = await listaDeSaneamientoOt(orgA.id);
    revisar("la lista de saneamiento reporta la solicitud huérfana sin inventarle OT",
      lista.solicitudesHuerfanas.some((r) => r.folio === "SS-HUERF") &&
      (await prisma.workRequest.findFirstOrThrow({ where: { organizationId: orgA.id, number: "SS-HUERF" } })).workOrderId === null);
    revisar("y las órdenes activas sin responsable", lista.activasSinResponsable.some((r) => r.folio === o1.number));
    revisar("la calidad de otra empresa no cuenta estas órdenes", (await saludDeDatos(orgB.id)).revisiones.find((r) => r.clave === "ot-sin-horas")!.total === 0);
  } finally {
    for (const org of [orgA.id, orgB.id]) {
      await prisma.downtimeEvent.deleteMany({ where: { asset: { organizationId: org } } });
      await prisma.organization.delete({ where: { id: org } });
    }
  }

  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  if (fallos) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
