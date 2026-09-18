/**
 * Bloque 5 — Avisos, escalamiento e integraciones: las 45 pruebas obligatorias.
 *
 * Todo en empresas creadas aquí y borradas al final; al terminar se compara
 * que las demás quedaron idénticas. Nada sale a la calle: el correo usa el
 * proveedor de prueba (`AVISOS_CORREO=prueba`), el navegador un transporte
 * simulado y los webhooks un receptor local en 127.0.0.1.
 *
 * Llama a las MISMAS funciones que las rutas y el proceso programado; la parte
 * de API, permisos y aislamiento entra por HTTP a un servidor de desarrollo.
 *
 *   npx tsx scripts/prueba-avisos.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { SignJWT } from "jose";

function llaveDeSesion(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const linea = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("AUTH_SECRET="));
  const valor = linea?.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!valor) throw new Error("No hay AUTH_SECRET en el entorno ni en .env");
  return valor;
}
// Antes de importar la aplicación: canales de prueba, nada real.
process.env.AUTH_SECRET = llaveDeSesion();
process.env.AVISOS_CORREO = "prueba";
process.env.AVISOS_WEBHOOK_PERMITIR_LOCAL = "1";

let fallos = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallos++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 240)}` : ""}`);
}
async function rechaza(afirmacion: string, fn: () => Promise<unknown>, contiene?: RegExp) {
  try { await fn(); revisar(afirmacion, false, "no se rechazó"); } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    revisar(afirmacion, !contiene || contiene.test(m), m);
  }
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

async function main() {
  const { prisma } = await import("../lib/db");
  const { notify } = await import("../lib/audit");
  const { emitirAviso } = await import("../lib/avisos/emitir");
  const { detectar } = await import("../lib/avisos/detectores");
  const { configDe } = await import("../lib/avisos/config");
  const { procesarEscalamientos } = await import("../lib/avisos/escalamiento");
  const { resumenDiario, resumenSemanal, enviarResumenes } = await import("../lib/avisos/resumenes");
  const { procesarEntregas, reintentarEntrega, FALLAS_PARA_SUSPENDER } = await import("../lib/avisos/entrega");
  const { usarTransportes, bandejaDePrueba, verificarFirma } = await import("../lib/avisos/canales");
  const { sumarEspera, siguienteMomentoHabil, dentroDeVentana } = await import("../lib/avisos/horario");
  const { calcularPrioridad } = await import("../lib/avisos/prioridad");
  const { ejecutarProgramador, correrAvisos } = await import("../lib/avisos/proceso");
  const { transitionWorkOrder, consumePart } = await import("../lib/workorders");
  const { crearRequisicionDeCompra } = await import("../lib/compras");
  const { ingestSensorReading } = await import("../lib/predictive");
  const { crearCredencial } = await import("../lib/integraciones/credenciales");
  const { crearWebhook, modificarWebhook, probarWebhook } = await import("../lib/integraciones/webhooks");
  const { validarDestino } = await import("../lib/integraciones/destino");
  void consumePart;

  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3204";
  if (!process.env.BASE_URL) servidor = spawn("npx", ["next", "dev", "-p", "3204", "-H", "127.0.0.1"], { stdio: "ignore", detached: true });

  // Receptor de webhooks local: responde lo que se le pida, guarda lo que llega.
  const recibidos: Array<{ headers: Record<string, string>; cuerpo: string }> = [];
  let respuestas: number[] = [];
  const receptor: Server = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (c) => { cuerpo += c; });
    req.on("end", () => {
      recibidos.push({ headers: req.headers as Record<string, string>, cuerpo });
      res.statusCode = respuestas.shift() ?? 200;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => receptor.listen(0, "127.0.0.1", r));
  const puerto = (receptor.address() as { port: number }).port;
  const urlReceptor = `http://127.0.0.1:${puerto}/hook`;

  const sello = `av-${Date.now()}`;
  const creadas: string[] = [];
  const foto = async () => {
    const where = { organizationId: { notIn: creadas } };
    return JSON.stringify(await Promise.all([
      prisma.notification.count({ where }), prisma.entregaAviso.count({ where }), prisma.escalamiento.count({ where }),
      prisma.workOrder.count({ where }), prisma.auditLog.count({ where }), prisma.credencialApi.count({ where }),
    ]));
  };
  const antes = await foto();
  const nuevaOrg = async (s: string, extra: Record<string, unknown> = {}) => {
    const o = await prisma.organization.create({
      data: { name: `${sello}-${s}`, slug: `${sello}-${s}`, plan: "ENTERPRISE", status: "ACTIVE", timezone: "America/Monterrey", diasHabiles: "1,2,3,4,5", ...extra },
    });
    creadas.push(o.id);
    return o;
  };
  const persona = (orgId: string, rol: string, nombre: string, email?: string) =>
    prisma.user.create({ data: { organizationId: orgId, email: email ?? `${nombre.toLowerCase()}-${sello}@t.mx`, name: nombre, role: rol, passwordHash: "x" } });
  const avisosDe = (userId: string, tipo?: string) => prisma.notification.findMany({ where: { userId, ...(tipo ? { tipo } : {}) } });

  try {
    const A = await nuevaOrg("a");
    const B = await nuevaOrg("b");
    const C = await nuevaOrg("c");
    const dueno = await persona(A.id, "OWNER", "Dueno");
    const admin = await persona(A.id, "ADMIN", "Admin");
    const sup = await persona(A.id, "SUPERVISOR", "Sup");
    const tec1 = await persona(A.id, "TECHNICIAN", "Tec1");
    const tec2 = await persona(A.id, "TECHNICIAN", "Tec2");
    const compras = await persona(A.id, "COMPRAS", "Compras");
    const solicitante = await persona(A.id, "REQUESTER", "Solicitante");
    const tecTemporal = await persona(A.id, "TECHNICIAN", "TecTemporal", `tt-${sello}@falla-temporal.invalid`);
    const tecPermanente = await persona(A.id, "TECHNICIAN", "TecPermanente", `tp-${sello}@falla-permanente.invalid`);
    const duenoB = await persona(B.id, "OWNER", "DuenoB");
    const tecC = await persona(C.id, "TECHNICIAN", "TecC");
    void dueno;

    const sitio = await prisma.site.create({ data: { organizationId: A.id, code: "S1", name: "Planta" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: A.id, siteId: sitio.id, code: "ALM", name: "Almacén", esGeneral: true } });
    const equipoA = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: "CR-1", name: "Compresor crítico", criticality: "A" } });
    const equipoB = await prisma.asset.create({ data: { organizationId: A.id, siteId: sitio.id, code: "BO-1", name: "Bomba", criticality: "B" } });
    const cfg = async () => configDe(A.id);

    // ─────────────────────────────────────────── 1-5 Órdenes
    console.log("\n1-5. Órdenes de trabajo");
    await esperarServidor(base, 240_000);
    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const sesion = async (u: { id: string; organizationId: string; email: string; name: string; role: string }) =>
      `mt_session=${await new SignJWT({ userId: u.id, organizationId: u.organizationId, email: u.email, name: u.name, role: u.role })
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}`;
    const pedir = async (metodo: string, ruta: string, cabeceras: Record<string, string>, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo, headers: { "Content-Type": "application/json", ...cabeceras },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}), signal: AbortSignal.timeout(120_000),
      });
      return { status: r.status, headers: r.headers, json: await r.json().catch(() => ({})) as Record<string, unknown> };
    };
    const cAdmin = { Cookie: await sesion(admin) };
    const cTec = { Cookie: await sesion(tec1) };
    const cDuenoB = { Cookie: await sesion(duenoB) };

    const alta = await pedir("POST", "/api/work-orders", cAdmin, {
      title: "Cambiar rodamiento", maintenanceType: "CORRECTIVE", priority: "MEDIUM", assetId: equipoB.id, assignedToId: tec1.id, aceptarAdvertencias: true,
    });
    const ot1 = (alta.json.workOrder as { id: string; number: string });
    const aTec1 = await avisosDe(tec1.id, "OT_ASIGNADA");
    revisar("1. nueva OT asignada: le llega al responsable, con acción y prioridad", alta.status === 201 && aTec1.length === 1 && aTec1[0].requiereAccion && aTec1[0].entidadId === ot1.id, { status: alta.status, avisos: aTec1.length });
    revisar("   y a nadie más", (await prisma.notification.count({ where: { tipo: "OT_ASIGNADA", entidadId: ot1.id } })) === 1);

    const critica = await pedir("POST", "/api/work-orders", cAdmin, {
      title: "Fuga de aire en compresor", maintenanceType: "CORRECTIVE", priority: "CRITICAL", assetId: equipoA.id, assignedToId: tec2.id, aceptarAdvertencias: true,
    });
    const otC = critica.json.workOrder as { id: string; number: string };
    const avisoCritSup = await avisosDe(sup.id, "OT_CRITICA_CREADA");
    revisar("2. OT crítica: la reciben supervisión y el responsable, como crítica", avisoCritSup.length === 1 && avisoCritSup[0].prioridad === "CRITICA" && (await avisosDe(tec2.id, "OT_ASIGNADA")).length === 1);
    revisar("   el administrador no es destinatario universal: con supervisor, no la recibe", (await avisosDe(admin.id, "OT_CRITICA_CREADA")).length === 0);

    const ahora = new Date();
    await prisma.workOrder.update({ where: { id: ot1.id }, data: { dueDate: new Date(ahora.getTime() + 5 * 3_600_000) } });
    await detectar(A.id, await cfg(), ahora);
    const porVencer = await avisosDe(tec1.id, "OT_POR_VENCER");
    revisar("3. OT próxima a vencer: aviso al responsable", porVencer.length === 1 && porVencer[0].porQue?.includes("Vence en") === true, porVencer[0]?.title);

    const otVencida = await prisma.workOrder.create({
      data: { organizationId: A.id, number: `V-${sello}`, title: "Revisar tablero", maintenanceType: "CORRECTIVE", priority: "MEDIUM", status: "ASSIGNED", assetId: equipoB.id, siteId: sitio.id, assignedToId: tec1.id, dueDate: new Date(ahora.getTime() - 30 * 3_600_000) },
    });
    await detectar(A.id, await cfg(), ahora);
    const vencida = await avisosDe(tec1.id, "OT_VENCIDA");
    revisar("4. OT vencida: aviso al responsable, alta (no crítica: estar vencida no la vuelve crítica)", vencida.length === 1 && vencida[0].prioridad === "ALTA", vencida[0]?.prioridad);

    const cambio = await pedir("PATCH", `/api/work-orders/${ot1.id}`, cAdmin, { assignedToId: tec2.id, aceptarAdvertencias: true });
    const asigTec2 = await prisma.notification.findMany({ where: { userId: tec2.id, tipo: "OT_ASIGNADA", entidadId: ot1.id } });
    const reasigTec1 = await avisosDe(tec1.id, "OT_REASIGNADA");
    const viejo = await prisma.notification.findFirst({ where: { userId: tec1.id, tipo: "OT_ASIGNADA", entidadId: ot1.id } });
    revisar("5. cambio de responsable: al nuevo le llega la asignación, al anterior que ya no es suya", cambio.status === 200 && asigTec2.length === 1 && reasigTec1.length === 1, { status: cambio.status });
    revisar("   y el aviso viejo queda atendido (no se borra, se atiende)", Boolean(viejo?.atendidaEl) && viejo?.atendidaMotivo === "la orden cambió de responsable");

    // ─────────────────────────────────────────── 6-13 Otros eventos
    console.log("\n6-13. Solicitudes, preventivo, medidores, almacén y compras");
    const solCrit = await prisma.workRequest.create({
      data: { organizationId: A.id, number: `S-${sello}`, title: "Olor a quemado", priority: "CRITICAL", riesgo: "ALTO", siteId: sitio.id, requestedById: solicitante.id, createdAt: new Date(ahora.getTime() - 40 * MIN) },
    });
    await procesarEscalamientos(A.id, await cfg(), ahora);
    await procesarEscalamientos(A.id, await cfg(), new Date(ahora.getTime() + 1 * MIN));
    const solEsc = await avisosDe(sup.id, "SOLICITUD_CRITICA_SIN_ATENDER");
    revisar("6. solicitud crítica sin atender: recordatorio a quien revisa, crítico", solEsc.length === 1 && solEsc[0].prioridad === "CRITICA", solEsc.length);

    const r7 = await ejecutarProgramador(A.id, { generar: async () => { throw new Error("tabla bloqueada (simulado)"); } });
    const fallo = await avisosDe(sup.id, "PLAN_FALLO_GENERAR");
    revisar("7. fallo al generar preventivo: se avisa a supervisión y las demás empresas no se afectan", !r7.ok && fallo.length === 1 && fallo[0].body?.includes("tabla bloqueada") === true);

    await detectar(A.id, await cfg(), ahora);
    const sinPlan = await avisosDe(sup.id, "ACTIVO_CRITICO_SIN_PLAN");
    revisar("8. activo crítico sin plan: un aviso agrupado que lo nombra", sinPlan.length === 1 && sinPlan[0].body?.includes("CR-1") === true);

    const sensor = await prisma.sensor.create({ data: { organizationId: A.id, assetId: equipoA.id, name: "Temperatura", sensorType: "TEMPERATURE", unit: "°C", warningThreshold: 70, criticalThreshold: 90 } });
    await ingestSensorReading({ organizationId: A.id, sensorId: sensor.id, value: 95, autoWorkOrder: false });
    await detectar(A.id, await cfg(), new Date());
    const umbral = await avisosDe(sup.id, "UMBRAL_EXCEDIDO");
    revisar("9. lectura que rebasa el umbral: aviso crítico a supervisión", umbral.length === 1 && umbral[0].prioridad === "CRITICA", umbral[0]?.title);

    const medidor = await prisma.meter.create({ data: { organizationId: A.id, assetId: equipoB.id, name: "Horómetro", unit: "h", currentValue: 100, lastReadingAt: new Date(ahora.getTime() - 20 * 86_400_000) } });
    const planUso = await prisma.maintenancePlan.create({ data: { organizationId: A.id, name: "Servicio 250 h", triggerType: "METER", intervalMeter: 250, assetId: equipoB.id, meterId: medidor.id } });
    await prisma.planAsset.create({ data: { organizationId: A.id, planId: planUso.id, assetId: equipoB.id, meterId: medidor.id, nextDueMeter: 350 } });
    await detectar(A.id, await cfg(), ahora);
    const sinLectura = await avisosDe(sup.id, "MEDIDOR_SIN_LECTURA");
    revisar("10. medidor sin lectura esperada: aviso agrupado", sinLectura.length === 1 && sinLectura[0].body?.includes("BO-1") === true);

    const filtro = await prisma.part.create({ data: { organizationId: A.id, code: "FIL-1", name: "Filtro", unit: "pza", minQuantity: 2, quantityOnHand: 0 } });
    const planCrit = await prisma.maintenancePlan.create({ data: { organizationId: A.id, name: "Mantto compresor", intervalDays: 30, assetId: equipoA.id, tasks: { create: [{ position: 0, title: "Cambiar filtro" }] } }, include: { tasks: true } });
    await prisma.planTaskPart.create({ data: { planTaskId: planCrit.tasks[0].id, partId: filtro.id } });
    await prisma.planAsset.create({ data: { organizationId: A.id, planId: planCrit.id, assetId: equipoA.id, nextDueDate: new Date(ahora.getTime() + 10 * 86_400_000) } });
    await detectar(A.id, await cfg(), ahora);
    const agotada = await avisosDe(compras.id, "REFACCION_CRITICA_AGOTADA");
    revisar("11. refacción crítica sin existencia: a compras/almacén, no a todo rol alto", agotada.length === 1 && (await avisosDe(admin.id, "REFACCION_CRITICA_AGOTADA")).length === 0);

    const req = await crearRequisicionDeCompra({
      organizationId: A.id, userId: admin.id, warehouseId: almacen.id, urgencia: "NORMAL", montoAutorizacion: 0,
      renglones: [{ descripcion: "Filtro", cantidadSolicitada: 5, costoEstimado: 100, partId: filtro.id }],
    });
    const porAut = await prisma.notification.findMany({ where: { tipo: "REQUISICION_POR_AUTORIZAR", entidadId: req.id } });
    revisar("12. requisición pendiente: a quien puede autorizar, nunca a quien la pidió", porAut.length >= 1 && porAut.every((n) => n.userId !== admin.id) && porAut.some((n) => n.userId === dueno.id));
    revisar("   siendo el único autorizador disponible, su aviso es obligatorio (no se puede apagar)", porAut.length === 1);

    const proveedor = await prisma.supplier.create({ data: { organizationId: A.id, name: "Proveedor X" } });
    const oc = await prisma.purchaseOrder.create({ data: { organizationId: A.id, folio: `OC-${sello}`, purchaseRequestId: req.id, supplierId: proveedor.id, warehouseId: almacen.id, fechaPrometida: new Date(ahora.getTime() - 3 * 86_400_000) } });
    await detectar(A.id, await cfg(), ahora);
    const ocVencida = await avisosDe(compras.id, "ENTREGA_VENCIDA");
    revisar("13. compra vencida: a compras, con el retraso", ocVencida.length === 1 && ocVencida[0].entidadId === oc.id && ocVencida[0].porQue?.includes("retraso") === true);

    // ─────────────────────────────────────────── 14-17 Preferencias y destinatarios
    console.log("\n14-17. Preferencias, obligatorios y destinatarios");
    await prisma.preferenciaAvisos.create({ data: { organizationId: A.id, userId: compras.id, tiposApagados: JSON.stringify(["ENTREGA_PROXIMA", "REFACCION_BAJO_MINIMO"]) } });
    await prisma.purchaseOrder.create({ data: { organizationId: A.id, folio: `OC2-${sello}`, purchaseRequestId: req.id, supplierId: proveedor.id, warehouseId: almacen.id, fechaPrometida: new Date(ahora.getTime() + 24 * 3_600_000) } });
    await prisma.part.create({ data: { organizationId: A.id, code: "BAJ-1", name: "Banda", unit: "pza", minQuantity: 3, quantityOnHand: 1 } });
    await detectar(A.id, await cfg(), ahora);
    const omitida = await prisma.entregaAviso.findFirst({ where: { userId: compras.id, tipo: "ENTREGA_PROXIMA", estado: "OMITIDA_PREFERENCIA" } });
    revisar("14. aviso configurable apagado: no llega y queda como «omitido por preferencia»", Boolean(omitida) && (await avisosDe(compras.id, "ENTREGA_PROXIMA")).length === 0);
    revisar("   pero el que pide acción y solo esa persona puede atender, le sigue llegando", (await avisosDe(compras.id, "REFACCION_BAJO_MINIMO")).length === 1);

    const pref = await pedir("PUT", "/api/avisos/preferencias", cTec, { tiposApagados: ["OT_CRITICA_CREADA", "OT_POR_VENCER"] });
    revisar("15. un aviso obligatorio no se puede apagar: se ignora y se dice", pref.status === 200 && (pref.json.ignorados as string[]).includes("OT_CRITICA_CREADA"), pref.json);
    await prisma.preferenciaAvisos.update({ where: { userId: tec1.id }, data: { tiposApagados: JSON.stringify(["OT_ASIGNADA"]) } });
    const otAlta = await prisma.workOrder.create({ data: { organizationId: A.id, number: `H-${sello}`, title: "Alta prioridad", maintenanceType: "CORRECTIVE", priority: "HIGH", status: "ASSIGNED", siteId: sitio.id, assignedToId: tec1.id } });
    const { avisarNuevaOrden } = await import("../lib/avisos/ordenes");
    await avisarNuevaOrden(A.id, otAlta.id);
    revisar("   ni siquiera un configurable, si es el responsable directo de algo alto", (await prisma.notification.count({ where: { userId: tec1.id, tipo: "OT_ASIGNADA", entidadId: otAlta.id } })) === 1);

    const ausente = await persona(A.id, "TECHNICIAN", "Ausente");
    await prisma.user.update({ where: { id: ausente.id }, data: { active: false } });
    const r16 = await notify({ organizationId: A.id, userId: ausente.id, title: "Para alguien inactivo", tipo: "OT_ASIGNADA", claveDedup: `x:${sello}` });
    const otAusente = await prisma.workOrder.create({ data: { organizationId: A.id, number: `Z-${sello}`, title: "Sin nadie", maintenanceType: "CORRECTIVE", priority: "MEDIUM", status: "ASSIGNED", siteId: sitio.id, assignedToId: ausente.id } });
    await avisarNuevaOrden(A.id, otAusente.id);
    revisar("16. usuario desactivado: no recibe y queda registrado", r16.estado === "SIN_DESTINATARIO" && (await avisosDe(ausente.id)).length === 0 &&
      Boolean(await prisma.entregaAviso.findFirst({ where: { userId: ausente.id, estado: "SIN_DESTINATARIO", errorCategoria: "USUARIO_INACTIVO" } })));

    const r17 = await emitirAviso({ organizationId: C.id, tipo: "OT_CRITICA_CREADA", entidad: "WorkOrder", entidadId: `x-${sello}`, titulo: "Crítica en C" });
    revisar("17. evento sin destinatario válido: no se descarta, se registra qué falta", Boolean(r17.sinDestinatario) &&
      Boolean(await prisma.entregaAviso.findFirst({ where: { organizationId: C.id, estado: "SIN_DESTINATARIO", errorDetalle: { contains: "supervisor" } } })), r17.sinDestinatario);
    const pendAdmin = await prisma.notification.findMany({ where: { organizationId: A.id, tipo: "CONFIGURACION_INCOMPLETA" } });
    revisar("   y cuando hay quién, se vuelve pendiente administrativo (la orden sin responsable activo)", pendAdmin.length >= 1 && pendAdmin.every((n) => [dueno.id, admin.id].includes(n.userId)));
    void tecC;

    // ─────────────────────────────────────────── 18-21 Jornada y escalamiento
    console.log("\n18-21. Jornada y escalamiento");
    const v = { zona: "America/Monterrey", horaInicio: "08:00", horaFin: "18:00", diasHabiles: [1, 2, 3, 4, 5], festivos: [] as string[] };
    const martes9 = new Date("2026-09-15T15:00:00Z"); // 9:00 en Monterrey (UTC-6)
    const r18 = sumarEspera(martes9, 240, v, true);
    revisar("18. recordatorio dentro de jornada: 4 h desde las 9:00 son las 13:00 del mismo día", r18.toISOString() === "2026-09-15T19:00:00.000Z", r18.toISOString());
    const viernes17 = new Date("2026-09-18T23:00:00Z"); // viernes 17:00
    const r19 = sumarEspera(viernes17, 240, v, true);
    revisar("19. fuera de jornada: 4 h desde el viernes 17:00 son el lunes 11:00", r19.toISOString() === "2026-09-21T17:00:00.000Z", r19.toISOString());
    revisar("   y un aviso no crítico nacido el sábado espera al lunes 8:00",
      siguienteMomentoHabil(new Date("2026-09-19T18:00:00Z"), v).toISOString() === "2026-09-21T14:00:00.000Z" && !dentroDeVentana(new Date("2026-09-19T18:00:00Z"), v));

    // OT crítica sin aceptar (otC, de tec2): recordatorios al responsable y luego a supervisión.
    const t0 = new Date();
    const escala = async (min: number) => procesarEscalamientos(A.id, await cfg(), new Date(t0.getTime() + min * MIN));
    await escala(0); await escala(31); await escala(62); await escala(93);
    const esc = await prisma.escalamiento.findUnique({ where: { organizationId_regla_entidadId: { organizationId: A.id, regla: "OT_CRITICA_SIN_ACEPTAR", entidadId: otC.id } } });
    const recordTec2 = await prisma.notification.findFirst({ where: { userId: tec2.id, tipo: "OT_SIN_ACEPTAR", entidadId: otC.id } });
    const escSup = await prisma.notification.findFirst({ where: { userId: sup.id, tipo: "OT_SIN_ACEPTAR", entidadId: otC.id } });
    revisar("20. escalamiento: dos recordatorios en UNA notificación al responsable y luego sube a supervisión",
      esc?.nivel === 1 && recordTec2?.veces === 2 && Boolean(escSup) && escSup!.title.startsWith("Escalado"), { nivel: esc?.nivel, veces: recordTec2?.veces });
    revisar("   la subida queda en la bitácora", (await prisma.auditLog.count({ where: { organizationId: A.id, action: "ESCALATION_RAISED", entityId: otC.id } })) === 1);
    await transitionWorkOrder({ workOrderId: otC.id, to: "IN_PROGRESS", userId: tec2.id, organizationId: A.id, rol: "TECHNICIAN" });
    await escala(200);
    const escDespues = await prisma.escalamiento.findUnique({ where: { id: esc!.id } });
    revisar("21. al iniciarse la orden el escalamiento se detiene y sus avisos quedan atendidos",
      escDespues?.estado === "DETENIDO" && Boolean((await prisma.notification.findUnique({ where: { id: recordTec2!.id } }))?.atendidaEl));

    // ─────────────────────────────────────────── 22-25 Deduplicación, agrupación, resúmenes
    console.log("\n22-25. Deduplicación, agrupación y resúmenes");
    const cuenta = await prisma.notification.count({ where: { organizationId: A.id } });
    await detectar(A.id, await cfg(), ahora);
    await detectar(A.id, await cfg(), ahora);
    revisar("22. correr el proceso otra vez no crea avisos nuevos del mismo problema", (await prisma.notification.count({ where: { organizationId: A.id } })) === cuenta);
    await prisma.part.createMany({ data: [1, 2, 3].map((i) => ({ organizationId: A.id, code: `P-${i}`, name: `Parte ${i}`, unit: "pza", minQuantity: 5, quantityOnHand: 1 })) });
    await prisma.preferenciaAvisos.update({ where: { userId: compras.id }, data: { tiposApagados: "[]" } });
    await detectar(A.id, await cfg(), ahora);
    const bajo = await avisosDe(compras.id, "REFACCION_BAJO_MINIMO");
    revisar("23. varias refacciones bajo mínimo: un solo aviso con la lista", bajo.length === 1 && /5 refacci/.test(bajo[0].title), bajo[0]?.title);

    const lunes8 = new Date("2026-09-21T14:30:00Z"); // lunes 8:30 Monterrey
    const cA = await cfg();
    const rTec = await resumenDiario(A.id, { id: tec2.id, role: "TECHNICIAN", name: "Tec2" }, cA, lunes8);
    const rSup = await resumenDiario(A.id, { id: sup.id, role: "SUPERVISOR", name: "Sup" }, cA, lunes8);
    const rDueno = await resumenDiario(A.id, { id: dueno.id, role: "OWNER", name: "Dueno" }, cA, lunes8);
    const titulos = (r: { secciones: Array<{ titulo: string }> }) => r.secciones.map((s) => s.titulo);
    revisar("24. resumen diario según el rol: el técnico ve lo suyo, supervisión la operación, el dueño además lo que espera su firma",
      titulos(rTec).every((t) => t.startsWith("Sus") || t.startsWith("Vencen")) && titulos(rSup).includes("Órdenes vencidas") && titulos(rDueno).includes("Compras por autorizar") && !titulos(rSup).includes("Compras por autorizar"),
      { tec: titulos(rTec), sup: titulos(rSup), dueno: titulos(rDueno) });
    revisar("   sin secciones vacías y con el periodo dicho", [rTec, rSup, rDueno].every((r) => r.secciones.every((s) => s.total > 0) && r.periodo.startsWith("Hoy")));
    const env = await enviarResumenes(A.id, cA, lunes8);
    const env2 = await enviarResumenes(A.id, cA, new Date(lunes8.getTime() + 10 * MIN));
    revisar("   se manda una vez por persona por día; quien no tiene nada no recibe", env.diarios > 0 && env2.diarios === 0 && env.vacios > 0, { env, env2 });
    const rSem = await resumenSemanal(A.id, { id: sup.id, role: "SUPERVISOR", name: "Sup" }, cA, lunes8);
    revisar("25. resumen semanal: la semana anterior completa, con su comparación y pendientes", rSem.periodo.startsWith("Semana del") && titulos(rSem).includes("Órdenes de la semana"), titulos(rSem));

    // ─────────────────────────────────────────── 26-30 Canales
    console.log("\n26-30. Correo y navegador");
    await prisma.preferenciaAvisos.deleteMany({ where: { userId: { in: [tec1.id] } } });
    const otP = await prisma.workOrder.create({ data: { organizationId: A.id, number: `P-${sello}`, title: "Para correo que falla", maintenanceType: "CORRECTIVE", priority: "MEDIUM", status: "ASSIGNED", siteId: sitio.id, assignedToId: tecPermanente.id } });
    await avisarNuevaOrden(A.id, otP.id);
    await procesarEntregas({ organizationId: A.id });
    const eP = await prisma.entregaAviso.findFirst({ where: { userId: tecPermanente.id, canal: "CORREO" } });
    revisar("26. el correo falla y la operación no: la orden existe, el aviso quedó en la campana", Boolean(await prisma.workOrder.findUnique({ where: { id: otP.id } })) && (await avisosDe(tecPermanente.id, "OT_ASIGNADA")).length === 1 && Boolean(eP));
    revisar("28. falla permanente: fallida al primer intento, sin reintentos", eP?.estado === "FALLIDA" && eP.intentos === 1 && eP.errorCategoria === "DESTINO_INVALIDO", { estado: eP?.estado, intentos: eP?.intentos });
    const manual = await reintentarEntrega({ organizationId: A.id, entregaId: eP!.id, userId: admin.id });
    revisar("   reintento manual: se vuelve a intentar y queda en la bitácora", manual.ok && (await prisma.auditLog.count({ where: { organizationId: A.id, action: "DELIVERY_RETRIED" } })) === 1);

    const otT = await prisma.workOrder.create({ data: { organizationId: A.id, number: `T-${sello}`, title: "Para correo intermitente", maintenanceType: "CORRECTIVE", priority: "MEDIUM", status: "ASSIGNED", siteId: sitio.id, assignedToId: tecTemporal.id } });
    await avisarNuevaOrden(A.id, otT.id);
    const e0 = await prisma.entregaAviso.findFirstOrThrow({ where: { userId: tecTemporal.id, canal: "CORREO" } });
    // Se fuerza a que toque ya, aunque haya nacido fuera de la ventana de avisos.
    await prisma.entregaAviso.update({ where: { id: e0.id }, data: { programadaPara: new Date() } });
    await procesarEntregas({ organizationId: A.id });
    const e1 = await prisma.entregaAviso.findUniqueOrThrow({ where: { id: e0.id } });
    await procesarEntregas({ organizationId: A.id, ahora: new Date(Date.now() + 2 * MIN) });
    await procesarEntregas({ organizationId: A.id, ahora: new Date(Date.now() + 10 * MIN) });
    const e3 = await prisma.entregaAviso.findUniqueOrThrow({ where: { id: e0.id } });
    revisar("27. falla temporal: queda en reintento con espera, y al tercer intento se entrega", e1.estado === "EN_REINTENTO" && Boolean(e1.proximoIntento) && e3.estado === "ENTREGADA" && e3.intentos === 3,
      { primero: e1.estado, final: e3.estado, intentos: e3.intentos });
    revisar("   el correo de prueba no salió de la máquina", bandejaDePrueba.every((m) => m.para.endsWith(".invalid") || m.para.endsWith("@t.mx")));

    await prisma.organization.update({ where: { id: A.id }, data: { avisosPush: true } });
    await prisma.pushSubscription.create({ data: { organizationId: A.id, userId: sup.id, endpoint: `https://push.invalid/${sello}`, p256dh: "x", auth: "y" } });
    let entregadosNav = 0;
    usarTransportes({ navegador: async () => { entregadosNav++; return { ok: true, proveedor: "simulado" }; } });
    await notify({ organizationId: A.id, userId: sup.id, title: "Aviso al celular", tipo: "OT_CRITICA_CREADA", prioridad: "CRITICA", claveDedup: `nav:${sello}` });
    const eNav = await prisma.entregaAviso.findFirst({ where: { userId: sup.id, canal: "NAVEGADOR" } });
    revisar("29. navegador con permiso: se entrega al momento", entregadosNav === 1 && eNav?.estado === "ENTREGADA");
    await prisma.preferenciaAvisos.upsert({ where: { userId: sup.id }, create: { organizationId: A.id, userId: sup.id, navegadorRechazado: true }, update: { navegadorRechazado: true } });
    await notify({ organizationId: A.id, userId: sup.id, title: "Otro aviso", tipo: "OT_CRITICA_CREADA", prioridad: "CRITICA", claveDedup: `nav2:${sello}` });
    revisar("30. permiso del navegador rechazado: no se intenta ni se vuelve a pedir", entregadosNav === 1 && (await prisma.entregaAviso.count({ where: { userId: sup.id, canal: "NAVEGADOR" } })) === 1);
    usarTransportes();

    // ─────────────────────────────────────────── 31-37 API
    console.log("\n31-37. Credenciales y API");
    const cred = await pedir("POST", "/api/integraciones/credenciales", cAdmin, { nombre: "Pasarela sensores", alcances: ["lecturas:crear", "solicitudes:crear", "activos:leer"] });
    const sec = cred.json.secreto as string;
    const lista = await pedir("GET", "/api/integraciones/credenciales", cAdmin);
    revisar("31. la credencial se crea y su secreto se ve UNA vez", cred.status === 201 && /^mt_[a-z0-9]{10}_/.test(sec) && !JSON.stringify(lista.json).includes(sec.split("_")[2]));
    const bearer = { Authorization: `Bearer ${sec}` };
    const act = await pedir("GET", "/api/v1/activos", bearer);
    revisar("   con ella se consulta la API, solo lo de su empresa y sin costos", act.status === 200 && (act.json.datos as Array<{ codigo: string; costoAdquisicion?: number }>).every((a) => ["CR-1", "BO-1"].includes(a.codigo) && !("costoAdquisicion" in a)));
    const insuf = await pedir("GET", "/api/v1/ordenes", bearer);
    revisar("32. alcance insuficiente: 403 con el permiso que falta", insuf.status === 403 && (insuf.json.error as { codigo: string }).codigo === "ALCANCE_INSUFICIENTE");
    const sitioB = await prisma.site.create({ data: { organizationId: B.id, code: "SB", name: "Planta B" } });
    const medidorB = await prisma.meter.create({ data: { organizationId: B.id, assetId: (await prisma.asset.create({ data: { organizationId: B.id, siteId: sitioB.id, code: "B-1", name: "De B" } })).id, name: "H", unit: "h" } });
    const ajena = await pedir("POST", "/api/v1/lecturas?organizationId=" + B.id, bearer, { medidor: medidorB.id, valor: 10 });
    revisar("33. contra un medidor de otra empresa: «no encontrado», aunque mande el id de la otra", ajena.status === 404 && (await prisma.meterReading.count({ where: { meterId: medidorB.id } })) === 0);
    const idem = { ...bearer, "Idempotency-Key": `sol-${sello}` };
    const s1 = await pedir("POST", "/api/v1/solicitudes", idem, { titulo: "Ruido en bomba", activo: "BO-1", prioridad: "HIGH" });
    const s2 = await pedir("POST", "/api/v1/solicitudes", idem, { titulo: "Ruido en bomba", activo: "BO-1", prioridad: "HIGH" });
    revisar("34. solicitud por API: se crea, avisa a quien revisa, y repetirla no la duplica",
      s1.status === 201 && s2.status === 201 && s2.headers.get("idempotencia-repetida") === "true" &&
      (await prisma.workRequest.count({ where: { organizationId: A.id, title: "Ruido en bomba" } })) === 1 &&
      (await prisma.notification.count({ where: { tipo: "SOLICITUD_NUEVA", entidadId: (s1.json as { id: string }).id } })) >= 1);
    const fecha = new Date(Date.now() - 60 * MIN).toISOString();
    const l1 = await pedir("POST", "/api/v1/lecturas", bearer, { medidor: medidor.id, valor: 110, unidad: "h", fecha });
    revisar("35. lectura válida por API: entra y el medidor se actualiza", l1.status === 201 && (await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } })).currentValue === 110, l1.json);
    const l2 = await pedir("POST", "/api/v1/lecturas", bearer, { medidor: medidor.id, valor: 110, fecha });
    revisar("36. lectura duplicada: no se duplica", l2.status === 200 && l2.json.duplicada === true && (await prisma.meterReading.count({ where: { meterId: medidor.id } })) === 1);
    const l3 = await pedir("POST", "/api/v1/lecturas", bearer, { medidor: medidor.id, valor: 90, fecha: new Date().toISOString() });
    revisar("37. lectura fuera de secuencia: rechazada con la regla, y se avisa a supervisión",
      l3.status === 422 && (l3.json.error as { codigo: string }).codigo === "FUERA_DE_SECUENCIA" && (await prisma.notification.count({ where: { organizationId: A.id, tipo: "LECTURA_ANORMAL", entidadId: medidor.id } })) >= 1, l3.json);
    const unidad = await pedir("POST", "/api/v1/lecturas", bearer, { medidor: medidor.id, valor: 120, unidad: "km" });
    revisar("   y una unidad incompatible también", unidad.status === 422 && (unidad.json.error as { codigo: string }).codigo === "UNIDAD_INCOMPATIBLE");

    // ─────────────────────────────────────────── 38-42 Webhooks y límites
    console.log("\n38-42. Webhooks y límites");
    const wh = await crearWebhook({ organizationId: A.id, userId: admin.id, nombre: "ERP", url: urlReceptor, eventos: ["OT_CRITICA_CREADA", "SOLICITUD_NUEVA"] });
    await emitirAviso({ organizationId: A.id, tipo: "OT_CRITICA_CREADA", entidad: "WorkOrder", entidadId: `wh-${sello}`, titulo: "Crítica para webhook", datos: { folio: "OT-9" } });
    await procesarEntregas({ organizationId: A.id });
    const llegado = recibidos.at(-1)!;
    revisar("38. webhook firmado: el receptor verifica firma, marca e identificador",
      Boolean(llegado) && verificarFirma(wh.secreto, llegado.headers["maintrack-marca"], llegado.cuerpo, llegado.headers["maintrack-firma"]) &&
      llegado.headers["maintrack-evento-id"] === JSON.parse(llegado.cuerpo).id);
    revisar("39. con otro secreto, o con una marca vieja, la firma no valida",
      !verificarFirma("whsec_otro", llegado.headers["maintrack-marca"], llegado.cuerpo, llegado.headers["maintrack-firma"]) &&
      !verificarFirma(wh.secreto, String(Number(llegado.headers["maintrack-marca"]) - 600), llegado.cuerpo, llegado.headers["maintrack-firma"]));
    const sinCred = await pedir("POST", "/api/v1/eventos", { Authorization: "Bearer mt_0000000000_falsa-falsa-falsa-falsa-falsa-falsa-12", "Idempotency-Key": "k" }, { tipo: "lectura", datos: {} });
    revisar("   un webhook entrante sin credencial válida se rechaza", sinCred.status === 401);

    respuestas = [500, 200];
    await emitirAviso({ organizationId: A.id, tipo: "OT_CRITICA_CREADA", entidad: "WorkOrder", entidadId: `wh2-${sello}`, titulo: "Reintento" });
    await procesarEntregas({ organizationId: A.id });
    const w1 = await prisma.entregaAviso.findFirstOrThrow({ where: { webhookId: wh.webhook.id, resumen: "Reintento" } });
    await procesarEntregas({ organizationId: A.id, ahora: new Date(Date.now() + 2 * MIN) });
    const w2 = await prisma.entregaAviso.findUniqueOrThrow({ where: { id: w1.id } });
    revisar("40. reintento de webhook: 500 la primera vez, entregado al reintentar", w1.estado === "EN_REINTENTO" && w2.estado === "ENTREGADA" && w2.intentos === 2, { antes: w1.estado, despues: w2.estado });

    const prohibidos = ["https://localhost/x", "http://ejemplo.com/x", "https://169.254.169.254/latest", "https://10.0.0.1/x", "https://intranet.local/x", "https://usr:pw@ejemplo.com/"];
    const res41 = await Promise.all(prohibidos.map((u) => validarDestino(u, { permitirLocal: false }).then(() => "PASÓ").catch((e: Error) => e.message)));
    revisar("41. destinos no permitidos: internos, sin https, metadatos, IPs y credenciales en la URL", res41.every((r) => r !== "PASÓ"), res41);
    await rechaza("   y crear un webhook hacia uno de ellos se rechaza", () => crearWebhook({ organizationId: A.id, userId: admin.id, nombre: "Malo", url: "https://169.254.169.254/x", eventos: ["OT_CRITICA_CREADA"] }), /IP|interna|privada/);

    const ventana = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const credId = (await prisma.credencialApi.findFirstOrThrow({ where: { organizationId: A.id } })).id;
    await prisma.limiteUso.upsert({ where: { clave_ventana: { clave: `api:cred:${credId}:activos`, ventana } }, create: { clave: `api:cred:${credId}:activos`, ventana, conteo: 120 }, update: { conteo: 120 } });
    const topado = await pedir("GET", "/api/v1/activos", bearer);
    const credB = await crearCredencial({ organizationId: B.id, userId: duenoB.id, nombre: "Otra empresa", alcances: ["activos:leer"] });
    const deB = await pedir("GET", "/api/v1/activos", { Authorization: `Bearer ${credB.secreto}` });
    revisar("42. límite alcanzado: 429 con Retry-After, sin afectar a otra empresa",
      topado.status === 429 && Boolean(topado.headers.get("retry-after")) && deB.status === 200 && (deB.json.datos as unknown[]).length === 1, { a: topado.status, b: deB.status });

    // Suspensión de un webhook que falla una y otra vez.
    const malo = await crearWebhook({ organizationId: A.id, userId: admin.id, nombre: "Caído", url: urlReceptor, eventos: ["SOLICITUD_NUEVA"] });
    await prisma.webhook.update({ where: { id: wh.webhook.id }, data: { estado: "PAUSADO" } });
    respuestas = Array(FALLAS_PARA_SUSPENDER + 2).fill(503);
    for (let i = 0; i < FALLAS_PARA_SUSPENDER; i++) {
      await emitirAviso({ organizationId: A.id, tipo: "SOLICITUD_NUEVA", entidad: "WorkRequest", entidadId: `caido-${i}-${sello}`, titulo: `Caído ${i}` });
    }
    await procesarEntregas({ organizationId: A.id });
    const suspendido = await prisma.webhook.findUniqueOrThrow({ where: { id: malo.webhook.id } });
    revisar("   tras fallas seguidas el webhook se suspende solo, y se avisa", suspendido.estado === "SUSPENDIDO" &&
      (await prisma.notification.count({ where: { organizationId: A.id, tipo: "INTEGRACION_CON_ERRORES" } })) >= 1);
    respuestas = [];

    // ─────────────────────────────────────────── 43-45 Aislamiento, auditoría, historial
    console.log("\n43-45. Aislamiento, auditoría e historial");
    const notB = await prisma.notification.create({ data: { organizationId: B.id, userId: duenoB.id, title: "De B" } });
    const credBId = (await prisma.credencialApi.findFirstOrThrow({ where: { organizationId: B.id } })).id;
    const whB = await crearWebhook({ organizationId: B.id, userId: duenoB.id, nombre: "WH de B", url: urlReceptor, eventos: ["OT_CRITICA_CREADA"] });
    const entregaA = await prisma.entregaAviso.findFirstOrThrow({ where: { organizationId: A.id, estado: "FALLIDA" } });
    const intentos = await Promise.all([
      pedir("PATCH", `/api/notifications/${notB.id}`, cAdmin, { accion: "leer" }),
      pedir("POST", `/api/integraciones/credenciales/${credBId}`, cAdmin, { accion: "revocar" }),
      pedir("PATCH", `/api/integraciones/webhooks/${whB.webhook.id}`, cAdmin, { estado: "PAUSADO" }),
      pedir("POST", `/api/avisos/entregas/${entregaA.id}`, cDuenoB),
    ]);
    const entregasB = await pedir("GET", "/api/avisos/entregas", cDuenoB);
    revisar("43. aviso, credencial, webhook y entrega de otra empresa: 404, aunque se manipule la URL",
      intentos.every((r) => r.status === 404) && (entregasB.json.entregas as Array<{ id: string }>).every((e) => e.id !== entregaA.id) &&
      (await prisma.credencialApi.findUniqueOrThrow({ where: { id: credBId } })).estado === "ACTIVA", intentos.map((r) => r.status));
    // El operador dentro de un cliente: su campana no muestra los avisos de su
    // propia empresa (sus ligas darían «no encontrado» dentro del cliente).
    const operador = await prisma.user.create({ data: { organizationId: A.id, email: `op-${sello}@t.mx`, name: "Operador", role: "OWNER", isSuperAdmin: true, passwordHash: "x" } });
    await prisma.notification.create({ data: { organizationId: A.id, userId: operador.id, title: "Aviso de su empresa", link: `/work-orders/${otC.id}` } });
    const cOperadorEnB = { Cookie: `mt_session=${await new SignJWT({ userId: operador.id, organizationId: A.id, actingOrganizationId: B.id, email: operador.email, name: operador.name, role: "OWNER" })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}` };
    const enB = await pedir("GET", "/api/notifications", cOperadorEnB);
    const enA = await pedir("GET", "/api/notifications", { Cookie: `mt_session=${await new SignJWT({ userId: operador.id, organizationId: A.id, email: operador.email, name: operador.name, role: "OWNER" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(secreto)}` });
    revisar("el operador dentro de un cliente no ve en la campana los avisos de su empresa, y se le dice dónde están",
      enB.status === 200 && (enB.json.notifications as unknown[]).length === 0 && enB.json.avisosEn === A.name &&
      (enA.json.notifications as unknown[]).length === 1 && enA.json.avisosEn === null, { enB: (enB.json.notifications as unknown[])?.length, enA: (enA.json.notifications as unknown[])?.length, avisosEn: enB.json.avisosEn });

    const tecConfig = await pedir("PUT", "/api/avisos/configuracion", cTec, { horaInicio: "07:00" });
    const tecCred = await pedir("POST", "/api/integraciones/credenciales", cTec, { nombre: "x", alcances: ["activos:leer"] });
    revisar("   un técnico no configura canales ni crea credenciales (403)", tecConfig.status === 403 && tecCred.status === 403);

    const revocar = await pedir("POST", `/api/integraciones/credenciales/${credId}`, cAdmin, { accion: "revocar" });
    const tras = await pedir("GET", "/api/v1/activos", bearer);
    revisar("31b. revocada, deja de servir en la siguiente petición", revocar.status === 200 && tras.status === 401 && (tras.json.error as { codigo: string }).codigo === "CREDENCIAL_REVOCADA");

    await pedir("PUT", "/api/avisos/configuracion", cAdmin, {
      canales: ["NAVEGADOR", "CORREO"], reglas: { OT_ALTA_SIN_ACEPTAR: { esperaMin: 120 } }, destinatariosAdmin: [admin.id], resumenDiario: false,
    });
    await modificarWebhook({ organizationId: A.id, userId: admin.id, id: wh.webhook.id, cambios: { estado: "ACTIVO" } });
    await probarWebhook({ organizationId: A.id, userId: admin.id, id: wh.webhook.id });
    const acciones = new Set((await prisma.auditLog.findMany({ where: { organizationId: A.id }, select: { action: true } })).map((a) => a.action));
    const esperadas = ["NOTIFICATION_PREFERENCES_CHANGED", "NOTIFY_CHANNELS_CHANGED", "ESCALATION_RULES_CHANGED", "ADMIN_RECIPIENTS_CHANGED", "SUMMARY_CONFIG_CHANGED",
      "API_KEY_CREATED", "API_KEY_REVOKED", "WEBHOOK_CREATED", "WEBHOOK_UPDATED", "WEBHOOK_TESTED", "DELIVERY_RETRIED", "ESCALATION_RAISED", "INTEGRATION_SUSPENDED"];
    const faltan = esperadas.filter((a) => !acciones.has(a));
    revisar("44. auditoría de cambios administrativos, sin secretos", !faltan.length, faltan);
    const bitacora = JSON.stringify(await prisma.auditLog.findMany({ where: { organizationId: A.id } }));
    revisar("   la bitácora no guarda secretos ni cada intento automático",
      !bitacora.includes(sec) && !bitacora.includes(wh.secreto) && !acciones.has("DELIVERY_ATTEMPTED"));
    const hist = await pedir("GET", "/api/avisos/entregas", cAdmin);
    const hTec = await pedir("GET", "/api/avisos/entregas", cTec);
    const filas = hist.json.entregas as Array<{ estado: string; canal: string; intentos: number; errorCategoria: string | null }>;
    revisar("45. historial técnico: cada entrega con canal, estado, intentos y error; solo administradores",
      hist.status === 200 && hTec.status === 403 && ["ENTREGADA", "FALLIDA"].every((e) => filas.some((f) => f.estado === e)) && filas.some((f) => f.canal === "WEBHOOK") && filas.some((f) => f.canal === "CORREO"),
      { estados: [...new Set(filas.map((f) => f.estado))] });

    // Extras: prioridad sin «todo crítico» y el proceso completo acotado a esta empresa.
    revisar("Prioridad: una OT media vencida es alta; solo es crítica si es crítica o el equipo es A",
      calcularPrioridad("ALTA", { prioridadRegistro: "MEDIUM", horasRestantes: -50 }).prioridad === "ALTA" &&
      calcularPrioridad("ALTA", { prioridadRegistro: "MEDIUM", criticidadActivo: "A", horasRestantes: -50 }).prioridad === "CRITICA");
    const corrida = await correrAvisos({ organizationId: A.id });
    revisar("El proceso programado corre completo para una empresa sin errores", corrida.empresas === 1 && !corrida.resumen.some((r) => "error" in r), corrida.resumen);
  } finally {
    usarTransportes();
    receptor.close();
    for (const id of [...creadas].reverse()) await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    if (servidor?.pid) { try { process.kill(-servidor.pid, "SIGTERM"); } catch { /* ya terminó */ } }
  }

  console.log("\nAislamiento de la prueba");
  revisar("las demás empresas quedaron exactamente como estaban", antes === await foto());
  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
