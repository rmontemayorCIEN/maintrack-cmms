/**
 * Bloque 5, pendientes 1 y 2: resúmenes sin repetidos y avisos atendidos solo
 * por resolución real. Las 30 pruebas obligatorias, más el caso de producción
 * (OT-000001 y OT-000004 marcadas «Atendida: la orden se reprogramó» mientras
 * seguían vencidas).
 *
 * Todo en empresas creadas aquí y borradas al final; al terminar se compara
 * que las demás quedaron idénticas. Nada sale a la calle: el correo usa el
 * proveedor de prueba y no hay navegadores suscritos.
 *
 * Llama a las MISMAS funciones que las rutas y el proceso programado; la
 * edición de órdenes, «Enterado» y las alertas entran por HTTP a un servidor
 * de desarrollo, para ejercitar la ruta real y no una copia.
 *
 *   npx tsx scripts/prueba-avisos-atendidos.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { apagarServidor } from "./apagar-servidor";

function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}
process.env.AUTH_SECRET = llaveDeSesion();
process.env.AVISOS_CORREO = "prueba";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 300)}` : ""}`);
}

async function esperarServidor(base: string, limiteMs: number) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try { const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) }); if (r.status < 500) return; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const CICLO = {
  rol: "OWNER", tomarla: true, motivo: "Motivo de prueba automatizada", resolution: "Trabajo realizado en prueba automatizada",
  motivoSinHoras: "Prueba automatizada sin horas", motivoSinDiagnostico: "Prueba automatizada sin diagnóstico",
};

async function main() {
  const { prisma } = await import("../lib/db");
  const { detectar } = await import("../lib/avisos/detectores");
  const { configDe } = await import("../lib/avisos/config");
  const { procesarEscalamientos } = await import("../lib/avisos/escalamiento");
  const { resumenDiario, resumenSemanal, enviarResumenes, consolidar, sinRepetir } = await import("../lib/avisos/resumenes");
  const { reconciliar, REGLAS_DE_AVISO } = await import("../lib/avisos/condiciones");
  const { EVENTOS } = await import("../lib/avisos/catalogo");
  const { notify } = await import("../lib/audit");
  const { transitionWorkOrder } = await import("../lib/workorders");
  const { crearRequisicionDeCompra, autorizar, recibir } = await import("../lib/compras");

  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3205";
  if (!process.env.BASE_URL) servidor = spawn("npx", ["next", "dev", "-p", "3205", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });

  const sello = `at-${Date.now()}`;
  const creadas: string[] = [];
  const foto = async () => {
    const where = { organizationId: { notIn: creadas } };
    return JSON.stringify(await Promise.all([
      prisma.notification.count({ where }), prisma.notification.count({ where: { ...where, atendidaEl: { not: null } } }),
      prisma.entregaAviso.count({ where }), prisma.escalamiento.count({ where }), prisma.historialAviso.count({ where }),
      prisma.workOrder.count({ where }), prisma.auditLog.count({ where }),
    ]));
  };
  const antes = await foto();
  const nuevaOrg = async (s: string) => {
    const o = await prisma.organization.create({
      data: { name: `${sello}-${s}`, slug: `${sello}-${s}`, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey", diasHabiles: "1,2,3,4,5" },
    });
    creadas.push(o.id);
    return o;
  };
  const persona = (orgId: string, rol: string, nombre: string) =>
    prisma.user.create({ data: { organizationId: orgId, email: `${nombre.toLowerCase()}-${sello}@t.mx`, name: nombre, role: rol, passwordHash: "x" } });
  const aviso = (userId: string, tipo: string, entidadId: string) =>
    prisma.notification.findMany({ where: { userId, tipo, entidadId }, orderBy: { createdAt: "asc" } });
  const abiertos = (userId: string, tipo: string, entidadId: string) =>
    prisma.notification.findMany({ where: { userId, tipo, entidadId, atendidaEl: null } });

  try {
    const A = await nuevaOrg("a");
    const C = await nuevaOrg("vacia");
    const dueno = await persona(A.id, "OWNER", "Dueno");
    const admin = await persona(A.id, "ADMIN", "Admin");
    const sup = await persona(A.id, "SUPERVISOR", "Sup");
    const tec1 = await persona(A.id, "TECHNICIAN", "Tec1");
    const tec2 = await persona(A.id, "TECHNICIAN", "Tec2");
    const compras = await persona(A.id, "COMPRAS", "Compras");
    const solo = await persona(C.id, "SUPERVISOR", "SoloC");
    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: A.id, siteId: sitio.id, code: "ALM", name: "Almacén", esGeneral: true } });
    const equipo = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: "BO-1", name: "Bomba", criticality: "B" } });
    // Reglas cortas para no esperar una jornada: 5 minutos y un recordatorio por nivel.
    await prisma.configAvisos.create({
      data: {
        organizationId: A.id,
        reglas: JSON.stringify({
          OT_VENCIDA_SIN_ACTUALIZAR: { esperaMin: 5, soloJornada: false, maxRecordatorios: 1 },
          ALERTA_CRITICA_SIN_RECONOCER: { esperaMin: 5, soloJornada: false, maxRecordatorios: 1 },
          REQUISICION_SIN_AUTORIZAR: { esperaMin: 5, soloJornada: false, maxRecordatorios: 1 },
        }),
      },
    });
    const cfg = () => configDe(A.id);
    const ahora = new Date();
    let n = 0;
    const ot = (datos: Record<string, unknown>) => prisma.workOrder.create({
      data: {
        organizationId: A.id, number: `OT-${sello}-${++n}`, title: `Orden ${n}`, maintenanceType: "CORRECTIVE", priority: "MEDIUM",
        status: "ASSIGNED", assetId: equipo.id, siteId: sitio.id, estimatedHours: 2, ...datos,
      },
    });

    await esperarServidor(base, 240_000);
    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const sesion = async (u: { id: string; organizationId: string; email: string; name: string; role: string }) =>
      ({ Cookie: `mt_session=${await new SignJWT({ userId: u.id, organizationId: u.organizationId, email: u.email, name: u.name, role: u.role })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}` });
    const pedir = async (metodo: string, ruta: string, cabeceras: Record<string, string>, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo, headers: { "Content-Type": "application/json", ...cabeceras },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}), signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
    };
    const cAdmin = await sesion(admin);
    const cTec1 = await sesion(tec1);
    const cSup = await sesion(sup);
    const editar = (id: string, cuerpo: Record<string, unknown>) => pedir("PATCH", `/api/work-orders/${id}`, cAdmin, { aceptarAdvertencias: true, ...cuerpo });

    // ═══════════════════════════════════════════ El caso de producción
    console.log("\nEl caso de producción: OT-000001 y OT-000004");
    // Como en producción: el aviso de vencida con la fecha en la clave (datos
    // anteriores al cambio) y el recordatorio de «sin movimiento» con su clave de escalamiento.
    const otProd = await ot({ assignedToId: tec1.id, dueDate: new Date(ahora.getTime() - 3 * DIA) });
    await notify({
      organizationId: A.id, userId: tec1.id, title: `${otProd.number} vencida`, link: `/work-orders/${otProd.id}`, tipo: "OT_VENCIDA", prioridad: "ALTA",
      modulo: "ORDENES", entidad: "WorkOrder", entidadId: otProd.id, requiereAccion: true,
      claveDedup: `OT_VENCIDA:${otProd.id}:${otProd.dueDate!.toISOString()}`,
    });
    await procesarEscalamientos(A.id, await cfg(), ahora);
    await procesarEscalamientos(A.id, await cfg(), ahora);
    const [base0] = await aviso(tec1.id, "OT_VENCIDA", otProd.id);
    for (let i = 0; i < 4; i++) await detectar(A.id, await cfg(), new Date(ahora.getTime() + i * 5 * MIN));
    const vProd = await aviso(tec1.id, "OT_VENCIDA", otProd.id);
    const baseProd = vProd.find((x) => x.id === base0.id)!;
    const escProd = vProd.find((x) => x.claveDedup?.includes(":esc-"));
    revisar("OT vencida con recordatorio de escalamiento: el aviso NO se atiende «porque se reprogramó»",
      !baseProd.atendidaEl && baseProd.atendidaMotivo === null, { atendida: baseProd.atendidaMotivo });
    revisar("   y no parpadea: cuatro corridas del proceso no lo cierran ni lo reabren", baseProd.veces === 1, { veces: baseProd.veces });
    revisar("   no se crea otro aviso de vencida: continúa el que ya tenía (su clave anterior)", vProd.filter((x) => !x.claveDedup?.includes(":esc-")).length === 1, vProd.map((x) => x.claveDedup));
    revisar("   el recordatorio «sin movimiento» sigue abierto (no hubo movimiento)", Boolean(escProd) && !escProd!.atendidaEl);
    revisar("   ningún aviso de esa OT dice «se reprogramó»", !(await prisma.notification.count({ where: { entidadId: otProd.id, atendidaMotivo: { contains: "reprogram" } } })));
    // Como está hoy en producción, a la mitad del parpadeo: el aviso quedó cerrado «porque se reprogramó».
    await prisma.notification.update({ where: { id: base0.id }, data: { atendidaEl: new Date(), atendidaMotivo: "la orden se reprogramó" } });
    await detectar(A.id, await cfg(), new Date(ahora.getTime() + 30 * MIN));
    const vProd2 = (await aviso(tec1.id, "OT_VENCIDA", otProd.id)).filter((x) => !x.claveDedup?.includes(":esc-"));
    revisar("   el aviso cerrado por error se reabre (el mismo, sin crear otro) y deja de decir «se reprogramó»",
      vProd2.length === 1 && vProd2[0].id === base0.id && !vProd2[0].atendidaEl && vProd2[0].atendidaMotivo === null &&
      Boolean(await prisma.historialAviso.findFirst({ where: { notificationId: base0.id, cambio: "REABIERTA" } })), vProd2.map((x) => [x.claveDedup, x.atendidaMotivo]));

    // ═══════════════════════════════════════════ Estado de avisos
    console.log("\n11-23. Estado de los avisos de órdenes");
    const vencida = async (datos: Record<string, unknown> = {}) => {
      const o = await ot({ assignedToId: tec1.id, dueDate: new Date(Date.now() - 2 * DIA), ...datos });
      await detectar(A.id, await cfg(), new Date());
      return o;
    };

    // 11
    const o11 = await vencida();
    const futura = new Date(Date.now() + 5 * DIA);
    const r11 = await editar(o11.id, { dueDate: futura.toISOString(), motivoReprogramacion: "Se espera refacción del proveedor" });
    const [a11] = await aviso(tec1.id, "OT_VENCIDA", o11.id);
    const h11 = await prisma.historialAviso.findFirst({ where: { notificationId: a11.id } });
    revisar("11. reprogramada a fecha futura: atendida con el motivo de la fecha",
      r11.status === 200 && Boolean(a11.atendidaEl) && a11.atendidaMotivo?.startsWith("La fecha compromiso se cambió a una fecha futura") === true, { status: r11.status, motivo: a11.atendidaMotivo });
    revisar("    historial: condición anterior y actual, evento, quién y proceso",
      h11?.cambio === "ATENDIDA" && h11.condicionAnterior === REGLAS_DE_AVISO.OT_VENCIDA!.condicion && /^Vence el/.test(h11.condicionActual ?? "") &&
      h11.evento?.startsWith("Reprogramación") === true && h11.actorId === admin.id && h11.origen === "FLUJO", h11);

    // 12
    const o12 = await vencida();
    const otraPasada = new Date(Date.now() - 1 * DIA);
    const r12 = await editar(o12.id, { dueDate: otraPasada.toISOString(), motivoReprogramacion: "Se movió por error a otra fecha pasada" });
    await detectar(A.id, await cfg(), new Date());
    const a12 = await aviso(tec1.id, "OT_VENCIDA", o12.id);
    revisar("12. reprogramada a otra fecha también vencida: sigue pendiente, mismo aviso, texto al día",
      r12.status === 200 && a12.length === 1 && !a12[0].atendidaEl && a12[0].title.includes("vencida desde"), { status: r12.status, avisos: a12.map((x) => [x.title, x.atendidaMotivo]) });

    // 13
    const o13 = await vencida();
    const r13 = await editar(o13.id, { dueDate: o13.dueDate!.toISOString(), motivoReprogramacion: "Sin cambio real" });
    const a13 = await aviso(tec1.id, "OT_VENCIDA", o13.id);
    revisar("13. «reprogramada» a la misma fecha: sigue pendiente", r13.status === 200 && a13.length === 1 && !a13[0].atendidaEl, { status: r13.status });

    // 14
    const o14 = await vencida();
    await transitionWorkOrder({ ...CICLO, workOrderId: o14.id, to: "IN_PROGRESS", userId: tec1.id, organizationId: A.id, rol: "TECHNICIAN" });
    await transitionWorkOrder({ ...CICLO, workOrderId: o14.id, to: "COMPLETED", userId: tec1.id, organizationId: A.id, rol: "TECHNICIAN" });
    const [a14] = await aviso(tec1.id, "OT_VENCIDA", o14.id);
    revisar("14. OT terminada: atendida «La OT fue terminada», por quien la terminó", a14.atendidaMotivo === "La OT fue terminada" &&
      (await prisma.historialAviso.findFirst({ where: { notificationId: a14.id } }))?.actorId === tec1.id, a14.atendidaMotivo);

    // 15
    const revision = await prisma.notification.findFirst({ where: { tipo: "OT_LISTA_REVISION", entidadId: o14.id, userId: sup.id } });
    await transitionWorkOrder({ ...CICLO, workOrderId: o14.id, to: "CLOSED", userId: sup.id, organizationId: A.id, rol: "SUPERVISOR" });
    const a15 = await prisma.notification.findUnique({ where: { id: revision!.id } });
    revisar("15. OT cerrada: el aviso «lista para revisión» se atiende «La OT fue cerrada»", Boolean(revision) && a15?.atendidaMotivo === "La OT fue cerrada", a15?.atendidaMotivo);

    // 16
    const o16 = await vencida();
    await transitionWorkOrder({ ...CICLO, workOrderId: o16.id, to: "CANCELLED", userId: sup.id, organizationId: A.id, rol: "SUPERVISOR", motivo: "Ya no se requiere el trabajo" });
    const [a16] = await aviso(tec1.id, "OT_VENCIDA", o16.id);
    revisar("16. OT cancelada: atendida «La OT fue cancelada»", a16.atendidaMotivo === "La OT fue cancelada", a16.atendidaMotivo);

    // 17 — con recordatorio escalado a supervisión antes de reasignar.
    const o17 = await vencida();
    const t17 = new Date();
    await procesarEscalamientos(A.id, await cfg(), t17);
    await procesarEscalamientos(A.id, await cfg(), t17);
    await procesarEscalamientos(A.id, await cfg(), new Date(t17.getTime() + 6 * MIN));
    const escSup17 = (await abiertos(sup.id, "OT_VENCIDA", o17.id)).find((x) => x.claveDedup?.includes(":esc-OT_VENCIDA_SIN_ACTUALIZAR-1"));
    const r17 = await editar(o17.id, { assignedToId: tec2.id });
    const [a17] = await aviso(tec1.id, "OT_VENCIDA", o17.id).then((l) => l.filter((x) => !x.claveDedup?.includes(":esc-")));
    const nuevo17 = (await abiertos(tec2.id, "OT_VENCIDA", o17.id)).filter((x) => !x.claveDedup?.includes(":esc-"));
    const sup17 = escSup17 ? await prisma.notification.findUnique({ where: { id: escSup17.id } }) : null;
    revisar("17. reasignada: el aviso del responsable anterior se cierra por reasignación",
      r17.status === 200 && a17.atendidaMotivo === "La OT se reasignó a Tec2", { status: r17.status, motivo: a17.atendidaMotivo });
    revisar("    el responsable nuevo tiene su aviso de vencida en el momento", nuevo17.length === 1, nuevo17.length);
    revisar("    y supervisión conserva el suyo (la OT sigue vencida y sin movimiento)", Boolean(sup17) && !sup17!.atendidaEl, { hay: Boolean(escSup17) });

    // 18
    const o18 = await vencida();
    await procesarEscalamientos(A.id, await cfg(), new Date());
    await procesarEscalamientos(A.id, await cfg(), new Date());
    const r18 = await editar(o18.id, { title: "Orden con título corregido", description: "Solo cambia el texto" });
    await detectar(A.id, await cfg(), new Date());
    const a18 = await abiertos(tec1.id, "OT_VENCIDA", o18.id);
    revisar("18. cambio irrelevante en una OT vencida: el aviso y el recordatorio siguen pendientes",
      r18.status === 200 && a18.length === 2 && a18.some((x) => x.claveDedup?.includes(":esc-")), { status: r18.status, abiertos: a18.length });

    // 19 y 20
    const [base18] = a18.filter((x) => !x.claveDedup?.includes(":esc-"));
    const r19 = await pedir("PATCH", `/api/notifications/${base18.id}`, cTec1, { accion: "leer" });
    await detectar(A.id, await cfg(), new Date());
    const a19 = await prisma.notification.findUnique({ where: { id: base18.id } });
    revisar("19. aviso leído, condición sin resolver: leído y pendiente", r19.status === 200 && a19!.read && !a19!.atendidaEl, { status: r19.status });
    const r20 = await pedir("PATCH", `/api/notifications/${base18.id}`, cTec1, { accion: "reconocer" });
    await detectar(A.id, await cfg(), new Date());
    const a20 = await prisma.notification.findUnique({ where: { id: base18.id } });
    revisar("20. «Enterado» con la condición sin resolver: sigue pendiente", r20.status === 200 && !a20!.atendidaEl, { status: r20.status });

    // 21 y 22
    const esc18 = a18.find((x) => x.claveDedup?.includes(":esc-"))!;
    await detectar(A.id, await cfg(), new Date());
    revisar("22. OT vencida sin movimiento: el recordatorio sigue pendiente", !(await prisma.notification.findUnique({ where: { id: esc18.id } }))!.atendidaEl);
    const tarea = await prisma.workOrderTask.create({ data: { workOrderId: o18.id, title: "Revisar sello" } });
    const r21 = await pedir("PATCH", `/api/work-orders/${o18.id}/tasks`, cTec1, { taskId: tarea.id, done: true });
    await detectar(A.id, await cfg(), new Date());
    const esc21 = await prisma.notification.findUnique({ where: { id: esc18.id } });
    const base21 = await prisma.notification.findUnique({ where: { id: base18.id } });
    revisar("21. OT vencida con movimiento: el recordatorio «sin movimiento» se atiende por el avance",
      r21.status === 200 && Boolean(esc21!.atendidaEl) && esc21!.atendidaMotivo?.startsWith("Hubo movimiento en la OT: se completó la actividad") === true, { status: r21.status, motivo: esc21!.atendidaMotivo });
    revisar("    pero el aviso «OT vencida» sigue pendiente: son condiciones distintas", !base21!.atendidaEl);

    // 23
    const r23a = await editar(o12.id, { dueDate: futura.toISOString(), motivoReprogramacion: "Se reprograma a la semana siguiente" });
    const [a23a] = (await aviso(tec1.id, "OT_VENCIDA", o12.id)).filter((x) => !x.claveDedup?.includes(":esc-"));
    const r23b = await editar(o12.id, { dueDate: new Date(Date.now() - 3 * DIA).toISOString(), motivoReprogramacion: "La fecha real de compromiso ya había pasado" });
    const a23 = (await aviso(tec1.id, "OT_VENCIDA", o12.id)).filter((x) => !x.claveDedup?.includes(":esc-"));
    const reabierta = await prisma.historialAviso.findFirst({ where: { notificationId: a23[0].id, cambio: "REABIERTA" } });
    revisar("23. resuelta y repetida: se atiende, y al volver a vencer se reabre el mismo aviso como ciclo nuevo",
      r23a.status === 200 && r23b.status === 200 && Boolean(a23a.atendidaEl) && a23.length === 1 && !a23[0].atendidaEl && a23[0].veces === 2 && Boolean(reabierta),
      { veces: a23[0].veces, atendidaAntes: Boolean(a23a.atendidaEl), reabierta: Boolean(reabierta) });

    // ═══════════════════════════════════════════ Compras, almacén, predictivo, preventivo
    console.log("\n24-30. Compras, almacén, predictivo y preventivo");
    const parte = await prisma.part.create({ data: { organizationId: A.id, code: `P-${sello}`, name: "Sello mecánico", unit: "pza", quantityOnHand: 0, minQuantity: 0 } });
    // 24
    const req = await crearRequisicionDeCompra({
      organizationId: A.id, userId: compras.id, warehouseId: almacen.id, urgencia: "NORMAL", montoAutorizacion: 0,
      renglones: [{ partId: parte.id, descripcion: "Sello mecánico", cantidadSolicitada: 4, costoEstimado: 100 }],
    });
    const reqId = (req as { id: string }).id;
    await detectar(A.id, await cfg(), new Date());
    const porAut = await prisma.notification.findMany({ where: { entidadId: reqId, tipo: "REQUISICION_POR_AUTORIZAR", atendidaEl: null } });
    await autorizar({ organizationId: A.id, requestId: reqId, userId: dueno.id, aprueba: true });
    const tras24 = await prisma.notification.findMany({ where: { id: { in: porAut.map((x) => x.id) } } });
    revisar("24. requisición autorizada: atendida «La requisición fue autorizada», con quién la firmó",
      porAut.length > 0 && tras24.every((x) => x.atendidaMotivo === "La requisición fue autorizada") &&
      (await prisma.historialAviso.findFirst({ where: { notificationId: porAut[0].id } }))?.actorId === dueno.id, tras24.map((x) => x.atendidaMotivo));

    // 25 y 26: orden de compra vencida, recibida en dos partes.
    const proveedor = await prisma.supplier.create({ data: { organizationId: A.id, name: "Proveedor" } });
    await prisma.purchaseRequest.update({ where: { id: reqId }, data: { estado: "EN_COMPRA", ordenCompra: "OC-1" } });
    const oc = await prisma.purchaseOrder.create({
      data: { organizationId: A.id, folio: `OC-${sello}`, purchaseRequestId: reqId, supplierId: proveedor.id, warehouseId: almacen.id, fechaPrometida: new Date(Date.now() - 2 * DIA) },
    });
    await detectar(A.id, await cfg(), new Date());
    const [vencOc] = await prisma.notification.findMany({ where: { entidadId: oc.id, tipo: "ENTREGA_VENCIDA", userId: compras.id } });
    const renglon = await prisma.purchaseRequestLine.findFirstOrThrow({ where: { requestId: reqId } });
    await recibir({ organizationId: A.id, userId: compras.id, purchaseRequestId: reqId, warehouseId: almacen.id, renglones: [{ requestLineId: renglon.id, partId: parte.id, cantidad: 1, costoUnitario: 100, conforme: true }] });
    await detectar(A.id, await cfg(), new Date());
    const parcial = await prisma.notification.findFirst({ where: { entidadId: reqId, tipo: "RECEPCION_PARCIAL", userId: compras.id } });
    revisar("25. compra recibida en parte: la entrega vencida sigue pendiente y nace «recepción parcial»",
      Boolean(vencOc) && !(await prisma.notification.findUnique({ where: { id: vencOc.id } }))!.atendidaEl && Boolean(parcial) && !parcial!.atendidaEl);
    await recibir({ organizationId: A.id, userId: compras.id, purchaseRequestId: reqId, warehouseId: almacen.id, renglones: [{ requestLineId: renglon.id, partId: parte.id, cantidad: 3, costoUnitario: 100, conforme: true }] });
    const v26 = await prisma.notification.findUnique({ where: { id: vencOc.id } });
    const p26 = await prisma.notification.findUnique({ where: { id: parcial!.id } });
    revisar("26. compra recibida completa: los dos se atienden «La compra fue recibida completamente», en el momento",
      v26?.atendidaMotivo === "La compra fue recibida completamente" && p26?.atendidaMotivo === "La compra fue recibida completamente", [v26?.atendidaMotivo, p26?.atendidaMotivo]);
    await detectar(A.id, await cfg(), new Date());
    revisar("    y el proceso no la vuelve a abrir (la orden de compra sigue «ABIERTA» en la base)", !(await abiertos(compras.id, "ENTREGA_VENCIDA", oc.id)).length);

    // 27: refacción crítica (detiene una actividad de una orden abierta) agotada y repuesta.
    const critica = await prisma.part.create({ data: { organizationId: A.id, code: `PC-${sello}`, name: "Rodamiento", unit: "pza", quantityOnHand: 0 } });
    const o27 = await ot({ assignedToId: tec1.id, dueDate: new Date(Date.now() + 10 * DIA) });
    await prisma.workOrderTask.create({ data: { workOrderId: o27.id, title: "Cambiar rodamiento", bloqueadaPorPartId: critica.id } });
    await detectar(A.id, await cfg(), new Date());
    const agot = await prisma.notification.findMany({ where: { entidadId: critica.id, tipo: "REFACCION_CRITICA_AGOTADA" } });
    await recibir({ organizationId: A.id, userId: compras.id, warehouseId: almacen.id, renglones: [{ partId: critica.id, cantidad: 2, costoUnitario: 50, conforme: true }] });
    const tras27 = await prisma.notification.findMany({ where: { id: { in: agot.map((x) => x.id) } } });
    revisar("27. refacción crítica repuesta: atendida con la existencia nueva", agot.length > 0 && tras27.every((x) => x.atendidaMotivo === "La existencia se repuso: 2 pza"), tras27.map((x) => x.atendidaMotivo));

    // 28 y 29: alerta predictiva crítica.
    const alerta = await prisma.predictiveAlert.create({ data: { organizationId: A.id, assetId: equipo.id, severity: "CRITICAL", title: "Vibración alta", message: "Vibración sobre el crítico", workOrderId: o27.id } });
    await detectar(A.id, await cfg(), new Date());
    const t28 = new Date();
    await procesarEscalamientos(A.id, await cfg(), new Date(t28.getTime() + 10 * MIN));
    await procesarEscalamientos(A.id, await cfg(), new Date(t28.getTime() + 10 * MIN));
    const avAlerta = await prisma.notification.findFirst({ where: { entidadId: alerta.id, tipo: "ALERTA_PREDICTIVA", userId: sup.id } });
    const escAlerta = await prisma.notification.findFirst({ where: { entidadId: alerta.id, tipo: "ALERTA_CRITICA_SIN_ATENDER", userId: sup.id } });
    const r28 = await pedir("POST", `/api/alerts/${alerta.id}`, cSup, { action: "ACKNOWLEDGE" });
    await detectar(A.id, await cfg(), new Date());
    const a28 = await prisma.notification.findUnique({ where: { id: avAlerta!.id } });
    const e28 = escAlerta ? await prisma.notification.findUnique({ where: { id: escAlerta.id } }) : null;
    revisar("28. alerta reconocida pero no resuelta: su aviso sigue pendiente", r28.status === 200 && Boolean(avAlerta) && !a28!.atendidaEl, { status: r28.status });
    revisar("    el recordatorio «sin reconocer» sí se atiende: esa condición se acabó", Boolean(e28?.atendidaEl) && /reconoci/.test(e28!.atendidaMotivo ?? ""), e28?.atendidaMotivo);
    await prisma.predictiveAlert.update({ where: { id: alerta.id }, data: { status: "RESOLVED", resueltaPorId: sup.id, resueltaEl: new Date() } });
    await detectar(A.id, await cfg(), new Date());
    revisar("29. alerta resuelta: atendida «La alerta predictiva fue resuelta»",
      (await prisma.notification.findUnique({ where: { id: avAlerta!.id } }))?.atendidaMotivo === "La alerta predictiva fue resuelta");

    // 30
    const plan = await prisma.maintenancePlan.create({ data: { organizationId: A.id, name: `Plan ${sello}`, toleranceDays: 1 } });
    const o30 = await ot({ assignedToId: tec1.id, maintenanceType: "PREVENTIVE", planId: plan.id, dueDate: new Date(Date.now() - 5 * DIA) });
    await detectar(A.id, await cfg(), new Date());
    const inc = await prisma.notification.findMany({ where: { entidadId: o30.id, tipo: "PREVENTIVO_INCUMPLIDO" } });
    const r30 = await editar(o30.id, { description: "Se agregan notas al preventivo" });
    await detectar(A.id, await cfg(), new Date());
    const tras30 = await prisma.notification.findMany({ where: { id: { in: inc.map((x) => x.id) } } });
    revisar("30. preventivo incumplido editado: sigue incumplido", r30.status === 200 && inc.length > 0 && tras30.every((x) => !x.atendidaEl), { status: r30.status, avisos: inc.length });

    // ═══════════════════════════════════════════ Resúmenes
    console.log("\n1-10. Resúmenes");
    await prisma.workOrder.updateMany({ where: { organizationId: A.id }, data: { status: "CANCELLED" } });
    await prisma.escalamiento.deleteMany({ where: { organizationId: A.id } });
    await prisma.predictiveAlert.updateMany({ where: { organizationId: A.id }, data: { status: "RESOLVED" } });
    const hoy = new Date();
    const sus = (r: { secciones: Array<{ titulo: string; items: Array<{ clave?: string; texto: string }> }> }, clave: string) =>
      r.secciones.flatMap((s) => s.items.filter((i) => i.clave === clave).map((i) => ({ seccion: s.titulo, texto: i.texto })));
    const clavesRepetidas = (r: { secciones: Array<{ items: Array<{ clave?: string }> }> }) => {
      const claves = r.secciones.flatMap((s) => s.items.map((i) => i.clave).filter(Boolean));
      return claves.length - new Set(claves).size;
    };

    const otDueno = await ot({ assignedToId: dueno.id, dueDate: new Date(hoy.getTime() - 2 * DIA), title: "Del dueño" });
    const otSup = await ot({ assignedToId: sup.id, dueDate: new Date(hoy.getTime() - 2 * DIA), title: "Del supervisor" });
    const otTec = await ot({ assignedToId: tec1.id, dueDate: new Date(hoy.getTime() - 2 * DIA), priority: "CRITICAL", title: "Crítica del técnico" });
    const alerta2 = await prisma.predictiveAlert.create({ data: { organizationId: A.id, assetId: equipo.id, severity: "WARNING", title: "Temperatura", message: "Sube", workOrderId: otTec.id } });
    const req2 = await crearRequisicionDeCompra({
      organizationId: A.id, userId: compras.id, warehouseId: almacen.id, urgencia: "NORMAL", montoAutorizacion: 0,
      renglones: [{ descripcion: "Grasa", cantidadSolicitada: 1, costoEstimado: 10 }],
    });
    const req2Id = (req2 as { id: string }).id;
    // Escalamientos de verdad: la requisición sube a nivel 1 y la OT crítica del técnico también (vencida sin movimiento).
    const tE = new Date();
    for (const m of [0, 0, 6, 12]) await procesarEscalamientos(A.id, await cfg(), new Date(tE.getTime() + m * MIN));
    const cA = await cfg();
    const pD = { id: dueno.id, role: "OWNER", name: "Dueno" };
    const pS = { id: sup.id, role: "SUPERVISOR", name: "Sup" };
    const pA = { id: admin.id, role: "ADMIN", name: "Admin" };
    const rD = await resumenDiario(A.id, pD, cA, hoy);
    const rS = await resumenDiario(A.id, pS, cA, hoy);
    const rA = await resumenDiario(A.id, pA, cA, hoy);

    const d1 = sus(rD, `WorkOrder:${otDueno.id}`);
    revisar("1. responsable y propietario: su OT una sola vez, en «Mis pendientes»", d1.length === 1 && d1[0].seccion === "Mis pendientes", d1);
    const s2 = sus(rS, `WorkOrder:${otSup.id}`);
    revisar("2. responsable y supervisor: su OT una sola vez, en «Mis pendientes», no repetida en «de mi equipo»", s2.length === 1 && s2[0].seccion === "Mis pendientes", s2);
    const a3 = sus(rA, `PurchaseRequest:${req2Id}`);
    revisar("3. autoriza y administra: la compra una vez, en «Pendientes que debo autorizar», aunque también esté escalada",
      a3.length === 1 && a3[0].seccion === "Pendientes que debo autorizar" && a3[0].texto.includes("escalado"), a3);
    const s4 = sus(rS, `WorkOrder:${otTec.id}`);
    revisar("4. mismo registro por varias reglas (crítica, vencida, escalada): una vez, con todo lo que le pasa",
      s4.length === 1 && s4[0].seccion === "Pendientes de mi equipo" && ["crítica", "vencida", "escalado"].every((e) => s4[0].texto.includes(e)), s4);
    const titulosD = rD.secciones.map((s) => s.titulo);
    revisar("5. registros distintos en secciones distintas: lo suyo, lo que firma y lo del equipo",
      ["Mis pendientes", "Pendientes que debo autorizar", "Pendientes de mi equipo"].every((t) => titulosD.includes(t)), titulosD);
    revisar("   y la alerta de la OT aparece aparte de la OT: son registros distintos (la deduplicación no se la come)",
      sus(rS, `PredictiveAlert:${alerta2.id}`).length === 1 && sus(rS, `WorkOrder:${otTec.id}`).length === 1);
    revisar("   ningún registro repetido en ningún resumen, ni secciones vacías ni dos títulos para la misma lista",
      [rD, rS, rA].every((r) => clavesRepetidas(r) === 0 && r.secciones.every((s) => s.total > 0) && new Set(r.secciones.map((s) => s.titulo)).size === r.secciones.length));

    const rVacio = await resumenDiario(C.id, { id: solo.id, role: "SUPERVISOR", name: "SoloC" }, await configDe(C.id), hoy);
    const envC = await enviarResumenes(C.id, await configDe(C.id), new Date("2026-09-21T14:30:00Z"));
    revisar("6. resumen sin pendientes: sin secciones, y no se manda", rVacio.secciones.length === 0 && envC.diarios === 0 && envC.semanales === 0 && envC.vacios >= 1, envC);

    const lunes = new Date("2026-09-21T14:30:00Z"); // lunes 8:30 Monterrey
    const env = await enviarResumenes(A.id, cA, lunes);
    const diarioD = await prisma.notification.findFirst({ where: { userId: dueno.id, tipo: "RESUMEN_DIARIO" } });
    const veces = (texto: string, aguja: string) => texto.split(aguja).length - 1;
    revisar("7. resumen diario enviado: cada OT aparece una vez en el texto",
      env.diarios > 0 && Boolean(diarioD) && [otDueno, otSup, otTec].every((o) => veces(diarioD!.body ?? "", o.number) <= 1) && veces(diarioD!.body ?? "", otDueno.number) === 1,
      { titulo: diarioD?.title });
    const rSem = await resumenSemanal(A.id, pS, cA, lunes);
    const semDup = sinRepetir([
      { titulo: "Uno", total: 2, items: [{ texto: "x", enlace: "/", clave: "WorkOrder:1" }, { texto: "y", enlace: "/", clave: "WorkOrder:2" }], accion: "a" },
      { titulo: "Dos", total: 1, items: [{ texto: "x otra vez", enlace: "/", clave: "WorkOrder:1" }], accion: "b" },
    ]);
    revisar("8. resumen semanal: sin registros repetidos; una sección que solo repetía, desaparece",
      clavesRepetidas(rSem) === 0 && rSem.secciones.length > 0 && semDup.length === 1 && semDup[0].items.length === 2, rSem.secciones.map((s) => s.titulo));

    // 9: avisos agrupados — el mismo registro escalado por dos reglas, y dos avisos abiertos iguales.
    const filasEsc = await prisma.escalamiento.findMany({ where: { organizationId: A.id, entidadId: otTec.id } });
    await detectar(A.id, cA, new Date()); // el aviso vigente de la OT del técnico
    await notify({
      organizationId: A.id, userId: tec1.id, title: `${otTec.number} vencida (clave vieja)`, tipo: "OT_VENCIDA", prioridad: "ALTA", modulo: "ORDENES",
      entidad: "WorkOrder", entidadId: otTec.id, requiereAccion: true, claveDedup: `OT_VENCIDA:${otTec.id}:vieja`,
    });
    await detectar(A.id, cA, new Date());
    const rec9 = await reconciliar({ organizationId: A.id });
    const abiertasTec = (await abiertos(tec1.id, "OT_VENCIDA", otTec.id)).filter((x) => !x.claveDedup?.includes(":esc-"));
    const unificada = await prisma.notification.findFirst({ where: { userId: tec1.id, entidadId: otTec.id, atendidaMotivo: "Se unificó con el aviso vigente del mismo registro" } });
    revisar("9. avisos agrupados: la OT con dos escalamientos sale una vez en el resumen; dos avisos iguales abiertos quedan en uno",
      filasEsc.length >= 1 && sus(rS, `WorkOrder:${otTec.id}`).length === 1 && abiertasTec.length === 1 && Boolean(unificada), { escalamientos: filasEsc.map((f) => f.regla), abiertas: abiertasTec.length, rec9 });

    const c10 = consolidar([
      { clave: "WorkOrder:x", nivel: 4, prioridad: 2, texto: "OT x", enlace: "/", etiqueta: "vence hoy o mañana", accion: "Revise la carga." },
      { clave: "WorkOrder:x", nivel: 1, prioridad: 3, texto: "OT x", enlace: "/", etiqueta: "vencida", accion: "Actualice su avance." },
      { clave: "WorkOrder:x", nivel: 4, prioridad: 4, texto: "OT x", enlace: "/", etiqueta: "crítica", accion: "Confirme responsable." },
    ]);
    revisar("10. prioridad más alta conservada al consolidar, en la sección más específica, con su acción",
      c10.length === 1 && c10[0].prioridad === 4 && c10[0].nivel === 1 && c10[0].accion === "Actualice su avance." && c10[0].etiqueta === "vence hoy o mañana · vencida · crítica", c10);
    const posCritica = rS.secciones.find((s) => s.titulo === "Pendientes de mi equipo")?.items.findIndex((i) => i.clave === `WorkOrder:${otTec.id}`);
    revisar("    y en el resumen real la crítica encabeza su sección", posCritica === 0, posCritica);

    // ═══════════════════════════════════════════ Reglas y aislamiento
    console.log("\nReglas por tipo y aislamiento");
    const conAccion = (Object.entries(EVENTOS) as Array<[string, { requiereAccion: boolean }]>).filter(([, d]) => d.requiereAccion).map(([k]) => k);
    const sinRegla = conAccion.filter((t) => !(REGLAS_DE_AVISO as Record<string, unknown>)[t]);
    revisar("Cada tipo de aviso que pide acción tiene su regla explícita (nace, permanece, actualiza, escala, se atiende)", !sinRegla.length, sinRegla);
    const reglasDescritas = Object.values(REGLAS_DE_AVISO).every((r) => r && [r.condicion, r.nace, r.permanece, r.actualiza, r.escala, r.atiende].every((x) => x.length > 3));
    revisar("   todas describen sus seis momentos", reglasDescritas);
    const genericos = await prisma.notification.count({ where: { organizationId: A.id, atendidaMotivo: { in: ["el registro cambió", "la compra avanzó", "se atendió o dejó de existir la condición"] } } });
    revisar("   ningún motivo genérico", genericos === 0);
    const corrida = await detectar(A.id, cA, new Date());
    revisar("El proceso programado corre completo para la empresa sin errores", typeof corrida === "object", corrida);
  } finally {
    for (const id of [...creadas].reverse()) await prisma.organization.delete({ where: { id } }).catch((e) => console.error("no se borró", id, e));
    await apagarServidor(servidor, 3205);
  }

  console.log("\nAislamiento de la prueba");
  revisar("las demás empresas quedaron exactamente como estaban", antes === await foto());
  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
