/**
 * Bloque 8, frente 3 — Concurrencia e idempotencia.
 *
 * Los doce casos del bloque, cada uno con DOS peticiones que salen a la vez
 * contra el servidor de verdad, con sesiones abiertas por `/api/auth/login`.
 *
 * Por que por HTTP y no llamando a las funciones: la carrera que importa es
 * la de dos peticiones, con su transaccion, su candado y su respuesta. Una
 * prueba que llama dos veces a la misma funcion en el mismo proceso no
 * reproduce eso; reproduce otra cosa que siempre sale bien.
 *
 * Lo que se exige en todos:
 *  - un solo registro,
 *  - una respuesta que gana y otra que explica que el registro ya cambio,
 *  - nada de existencias negativas,
 *  - y las demas empresas intactas.
 *
 *   npx tsx scripts/prueba-concurrencia.ts
 */
import { prisma } from "../lib/db";
import {
  borrarEmpresas, empresaConRoles, entrar, esperarServidor, fotoDeLasDemas,
  levantarServidor, pedir, type Respuesta,
} from "./apoyo-pruebas";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const CLAVE = "Prueba-Concurrencia-2026";

let fallas = 0;
const matriz: Array<{ caso: string; esperado: string; real: string; estado: string }> = [];

function revisar(caso: string, esperado: string, bien: boolean, real: unknown) {
  if (!bien) fallas++;
  const texto = typeof real === "string" ? real : JSON.stringify(real);
  matriz.push({ caso, esperado, real: texto, estado: bien ? "APROBADO" : "FALLIDO" });
  console.log(`  ${bien ? "ok   " : "FALLA"} ${caso}`);
  console.log(`         esperado: ${esperado}`);
  console.log(`         real:     ${texto.slice(0, 220)}`);
}

/** Las dos peticiones salen juntas; la segunda con un respiro minimo para que compitan de verdad. */
const aLaVez = (a: () => Promise<Respuesta>, b: () => Promise<Respuesta>) =>
  Promise.all([a(), new Promise((r) => setTimeout(r, 15)).then(b)]) as Promise<[Respuesta, Respuesta]>;

const estados = (rs: Respuesta[]) => rs.map((r) => r.status).sort().join(",");

async function main() {
  const servidor = levantarServidor(3211);
  const sello = `conc-${Date.now()}`;
  const creadas: string[] = [];

  try {
    const { org, cuentas } = await empresaConRoles(sello, CLAVE);
    creadas.push(org.id);
    const antes = await fotoDeLasDemas(creadas);

    // ── Datos de trabajo, por los caminos normales de siembra ──────────────
    const sitio = await prisma.site.create({ data: { organizationId: org.id, code: "S1", name: "Planta" } });
    const almacen = await prisma.warehouse.create({ data: { organizationId: org.id, siteId: sitio.id, code: "ALM", name: "Almacén", esGeneral: true } });
    const equipo = await prisma.asset.create({ data: { organizationId: org.id, siteId: sitio.id, code: "EQ-1", name: "Bomba", criticality: "A" } });
    const parte = await prisma.part.create({ data: { organizationId: org.id, code: "REF-1", name: "Sello", unit: "pza", unitCost: 100, quantityOnHand: 0 } });
    const proveedor = await prisma.supplier.create({ data: { organizationId: org.id, name: "Proveedor de prueba" } });
    const medidor = await prisma.meter.create({
      data: { organizationId: org.id, assetId: equipo.id, name: "Horómetro", unit: "h", tipo: "HOROMETRO", currentValue: 1000, lastReadingAt: new Date(Date.now() - 2 * 86_400_000) },
    });

    const { aplicarMovimiento } = await import("../lib/almacen");
    await aplicarMovimiento({
      organizationId: org.id, partId: parte.id, warehouseId: almacen.id,
      tipo: "IN", cantidad: 1, costoUnitario: 100, userId: cuentas.OWNER.id, referencia: "Existencia inicial de la prueba",
    });

    await esperarServidor(BASE);

    // ── Sesiones reales: cada quien entra con su contraseña ────────────────
    const c: Record<string, Record<string, string>> = {};
    for (const rol of ["OWNER", "ADMIN", "SUPERVISOR", "TECHNICIAN", "COMPRAS", "REQUESTER"]) {
      c[rol] = await entrar(BASE, cuentas[rol].email, CLAVE);
    }
    console.log(`\nEmpresa ${sello} · seis sesiones abiertas por /api/auth/login\n`);

    // ═══════════════════════════════ 1. Dos cierres de la misma OT
    console.log("1-2. La misma orden, cerrada y reabierta por dos personas a la vez");
    // La orden llega a COMPLETED por el camino real —con sus horas y su
    // solución—, porque cerrar exige que esté completa. Probar la carrera de
    // cierre sobre una orden a medias probaría la validación, no la carrera.
    const ot = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: `OT-C1-${sello}`, title: "Cierre simultáneo", maintenanceType: "INSPECTION",
        status: "IN_PROGRESS", assetId: equipo.id, assignedToId: cuentas.TECHNICIAN.id, startedAt: new Date(),
      },
    });
    await pedir(BASE, "POST", `/api/work-orders/${ot.id}/labor`, c.TECHNICIAN, { hours: 1, notes: "Revisión" });
    const completada = await pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.TECHNICIAN, {
      status: "COMPLETED", resolution: "Revisado y sin novedad", motivoSinDiagnostico: "Inspección sin falla", sinParoConfirmado: true,
    });
    if (completada.status !== 200) throw new Error(`No se pudo completar la orden de la prueba: ${completada.status} ${JSON.stringify(completada.json).slice(0, 160)}`);
    const cierres = await aLaVez(
      () => pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.SUPERVISOR, { status: "CLOSED" }),
      () => pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.ADMIN, { status: "CLOSED" }),
    );
    const trasCerrar = await prisma.workOrder.findUniqueOrThrow({ where: { id: ot.id } });
    // La evidencia es la bitácora: el paso a «cerrada» tiene que aparecer una
    // sola vez, aunque las dos peticiones contesten 200 (la segunda encuentra
    // la orden ya en ese estado y devuelve sin repetir nada).
    const bitacoraCierre = await prisma.auditLog.count({
      where: { organizationId: org.id, entityId: ot.id, action: "STATUS_CHANGED", summary: { contains: "→ CLOSED" } },
    });
    revisar(
      "Dos personas cierran la misma OT al mismo tiempo",
      "la orden queda cerrada y la bitácora registra UN solo paso a cerrada",
      trasCerrar.status === "CLOSED" && bitacoraCierre === 1,
      { respuestas: estados(cierres), estado: trasCerrar.status, pasosACerrada: bitacoraCierre },
    );

    // ═══════════════════════════════ 2. Dos reaperturas
    // Reabrir una cerrada la regresa a COMPLETED (lib/reglas-ot.ts): se
    // corrige lo que faltó y se vuelve a cerrar.
    const reaperturas = await aLaVez(
      () => pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.ADMIN, { status: "COMPLETED", motivo: "Faltó una actividad" }),
      () => pedir(BASE, "POST", `/api/work-orders/${ot.id}/status`, c.OWNER, { status: "COMPLETED", motivo: "Faltó una actividad" }),
    );
    const trasReabrir = await prisma.workOrder.findUniqueOrThrow({ where: { id: ot.id } });
    const pasosAReabrir = await prisma.auditLog.count({
      where: { organizationId: org.id, entityId: ot.id, action: "STATUS_CHANGED", summary: { contains: "CLOSED → COMPLETED" } },
    });
    revisar(
      "Dos personas reabren la misma OT al mismo tiempo",
      "se reabre una sola vez y el evento de paro no se duplica",
      trasReabrir.status === "COMPLETED" && pasosAReabrir === 1 &&
      (await prisma.downtimeEvent.count({ where: { workOrderId: ot.id } })) <= 1,
      { respuestas: estados(reaperturas), estado: trasReabrir.status, reaperturas: pasosAReabrir, paros: await prisma.downtimeEvent.count({ where: { workOrderId: ot.id } }) },
    );

    // ═══════════════════════════════ 3. Doble clic al crear una solicitud
    console.log("\n3-4. Solicitudes: doble clic y doble conversión");
    const titulo = `Fuga en la bomba ${sello}`;
    const solicitudes = await aLaVez(
      () => pedir(BASE, "POST", "/api/requests", c.REQUESTER, { title: titulo, description: "Gotea por el sello", assetId: equipo.id, tipo: "FALLA" }),
      () => pedir(BASE, "POST", "/api/requests", c.REQUESTER, { title: titulo, description: "Gotea por el sello", assetId: equipo.id, tipo: "FALLA" }),
    );
    const cuantasSolicitudes = await prisma.workRequest.count({ where: { organizationId: org.id, title: titulo } });
    revisar(
      "Doble clic al crear una solicitud",
      "se levanta UNA solicitud; la segunda responde 409 diciendo que ya se envió",
      cuantasSolicitudes === 1 && estados(solicitudes) === "201,409",
      { respuestas: estados(solicitudes), solicitudes: cuantasSolicitudes, mensaje: solicitudes.find((r) => r.status === 409)?.json.error },
    );

    // ═══════════════════════════════ 4. Doble conversión de la misma solicitud
    const sol = await prisma.workRequest.findFirstOrThrow({ where: { organizationId: org.id, title: titulo } });
    const conversiones = await aLaVez(
      () => pedir(BASE, "POST", `/api/requests/${sol.id}`, c.SUPERVISOR, { action: "APPROVE", assignedToId: cuentas.TECHNICIAN.id }),
      () => pedir(BASE, "POST", `/api/requests/${sol.id}`, c.ADMIN, { action: "APPROVE", assignedToId: cuentas.TECHNICIAN.id }),
    );
    const ordenesDeLaSolicitud = await prisma.workOrder.count({ where: { organizationId: org.id, tasks: { some: { origenRequestId: sol.id } } } });
    const solTras = await prisma.workRequest.findUniqueOrThrow({ where: { id: sol.id } });
    revisar(
      "Dos personas convierten la misma solicitud en orden",
      "se crea UNA orden y la solicitud queda convertida una sola vez",
      ordenesDeLaSolicitud === 1 && solTras.status === "CONVERTED" && estados(conversiones) === "201,409",
      { respuestas: estados(conversiones), ordenes: ordenesDeLaSolicitud, solicitud: solTras.status, mensaje: conversiones.find((r) => r.status === 409)?.json.error },
    );

    // ═══════════════════════════════ 5. Dos consumos de la última pieza
    console.log("\n5-6. Almacén: la última pieza y dos ajustes");
    const otMaterial = await prisma.workOrder.create({
      data: {
        organizationId: org.id, number: `OT-C2-${sello}`, title: "Consumo simultáneo", maintenanceType: "CORRECTIVE",
        status: "IN_PROGRESS", assetId: equipo.id, assignedToId: cuentas.TECHNICIAN.id, startedAt: new Date(),
      },
    });
    const consumos = await aLaVez(
      () => pedir(BASE, "POST", `/api/work-orders/${otMaterial.id}/parts`, c.TECHNICIAN, { partId: parte.id, quantity: 1 }),
      () => pedir(BASE, "POST", `/api/work-orders/${otMaterial.id}/parts`, c.SUPERVISOR, { partId: parte.id, quantity: 1 }),
    );
    const parteTras = await prisma.part.findUniqueOrThrow({ where: { id: parte.id } });
    const existencia = await prisma.partStock.findFirstOrThrow({ where: { partId: parte.id, warehouseId: almacen.id } });
    revisar(
      "Dos consumos simultáneos de la última pieza",
      "solo uno la consume; la existencia queda en 0, nunca negativa, y al que pierde se le dice que vuelva a intentar (409, no 500)",
      parteTras.quantityOnHand === 0 && existencia.quantity === 0 &&
      (await prisma.workOrderPart.count({ where: { workOrderId: otMaterial.id } })) === 1 &&
      estados(consumos) === "201,409",
      { respuestas: estados(consumos), existencia: existencia.quantity, renglones: await prisma.workOrderPart.count({ where: { workOrderId: otMaterial.id } }), mensaje: consumos.find((r) => r.status >= 400)?.json.error },
    );

    // ═══════════════════════════════ 6. Dos ajustes simultáneos de inventario
    const ajustes = await aLaVez(
      () => pedir(BASE, "POST", "/api/parts/movements", c.OWNER, { partId: parte.id, warehouseId: almacen.id, movementType: "ADJUST", quantity: 7, motivo: "CONTEO_FISICO", reference: "Conteo A" }),
      () => pedir(BASE, "POST", "/api/parts/movements", c.ADMIN, { partId: parte.id, warehouseId: almacen.id, movementType: "ADJUST", quantity: 9, motivo: "CONTEO_FISICO", reference: "Conteo B" }),
    );
    const trasAjuste = await prisma.partStock.findFirstOrThrow({ where: { partId: parte.id, warehouseId: almacen.id } });
    const kardex = await prisma.stockMovement.findMany({
      where: { organizationId: org.id, partId: parte.id, movementType: "ADJUST" },
      orderBy: { createdAt: "asc" }, select: { quantity: true, balanceAfter: true, reference: true },
    });
    const ultimoKardex = kardex.at(-1);
    revisar(
      "Dos ajustes simultáneos de inventario",
      "los dos quedan en el kardex, en orden, y la existencia coincide con el último",
      !!ultimoKardex && trasAjuste.quantity === ultimoKardex.balanceAfter && [7, 9].includes(trasAjuste.quantity),
      { respuestas: estados(ajustes), existencia: trasAjuste.quantity, kardex },
    );

    // ═══════════════════════════════ 7. Dos recepciones de la misma compra
    console.log("\n7. Compras: dos recepciones de la misma orden de compra");
    const requisicion = await prisma.purchaseRequest.create({
      data: {
        organizationId: org.id, folio: `RC-C-${sello}`, estado: "EN_COMPRA", solicitanteId: cuentas.COMPRAS.id,
        warehouseId: almacen.id, montoEstimado: 200, proveedorSugeridoId: proveedor.id,
        renglones: { create: [{ partId: parte.id, descripcion: "Sello", cantidadSolicitada: 2, costoEstimado: 100 }] },
      },
      include: { renglones: true },
    });
    const claveRecepcion = `rec-${sello}`;
    const recepciones = await aLaVez(
      () => pedir(BASE, "POST", `/api/compras/${requisicion.id}`, c.COMPRAS, { accion: "RECIBIR", clave: claveRecepcion, renglones: [{ requestLineId: requisicion.renglones[0].id, partId: parte.id, cantidad: 2, costoUnitario: 100 }] }),
      () => pedir(BASE, "POST", `/api/compras/${requisicion.id}`, c.COMPRAS, { accion: "RECIBIR", clave: claveRecepcion, renglones: [{ requestLineId: requisicion.renglones[0].id, partId: parte.id, cantidad: 2, costoUnitario: 100 }] }),
    );
    const nRecepciones = await prisma.goodsReceipt.count({ where: { organizationId: org.id, clave: claveRecepcion } });
    const entradas = await prisma.stockMovement.count({ where: { organizationId: org.id, partId: parte.id, movementType: "IN", goodsReceiptId: { not: null } } });
    revisar(
      "Dos recepciones simultáneas de la misma compra",
      "se registra UNA recepción y UNA entrada al almacén (clave de idempotencia)",
      nRecepciones === 1 && entradas === 1,
      { respuestas: estados(recepciones), recepciones: nRecepciones, entradas },
    );

    // ═══════════════════════════════ 8-9. Preventivos y por medidor
    console.log("\n8-9. Programador: por calendario y por medidor");
    const { altaDePlan } = await import("../lib/alta-de-plan");
    const ayer = new Date(Date.now() - 86_400_000);
    const base = {
      maintenanceType: "PREVENTIVE", leadTimeDays: 3, toleranceDays: 2, priority: "MEDIUM", estimatedHours: 1,
      requiresShutdown: false, active: true,
      tasks: [{ title: "Revisar", taskType: "CHECK", required: true, parts: [], labor: [], services: [] }],
    };
    const porFecha = await altaDePlan(org.id, cuentas.ADMIN.id, {
      ...base, triggerType: "CALENDAR", intervalDays: 30,
      name: "Preventivo por calendario", assetId: equipo.id, nextDueDate: ayer.toISOString(),
    });
    if ("error" in porFecha) throw new Error(`No dio de alta el plan: ${porFecha.error}`);

    const generaciones = await aLaVez(
      () => pedir(BASE, "POST", "/api/scheduler", c.ADMIN, {}),
      () => pedir(BASE, "POST", "/api/scheduler", c.SUPERVISOR, {}),
    );
    const generadas = await prisma.workOrder.count({ where: { organizationId: org.id, planId: porFecha.plan.id } });
    revisar(
      "Doble generación de preventivos (dos corridas a la vez)",
      "se genera UNA orden por plan y equipo, no dos",
      generadas === 1,
      { respuestas: estados(generaciones), ordenes: generadas },
    );

    const porUso = await altaDePlan(org.id, cuentas.ADMIN.id, {
      // Cada 10 h: sin `nextDueMeter` la meta es «lectura actual + intervalo»
      // (1000 + 10 = 1010), y la lectura de 1020 la cruza. Con un intervalo
      // grande haría falta una lectura que el validador rechazaría por
      // imposible —un horómetro no suma más horas que el reloj—.
      ...base, triggerType: "METER", meterId: medidor.id, intervalMeter: 10,
      name: "Preventivo por horas", assetId: equipo.id,
    });
    if ("error" in porUso) throw new Error(`No dio de alta el plan por medidor: ${porUso.error}`);
    // La lectura cruza la meta: el programador debe generar una sola orden.
    /**
     * La meta se fija antes de la lectura, como esta en la vida real.
     *
     * Un plan por medidor recien dado de alta no trae meta: la primera se
     * calcula sobre la lectura del momento, para que no genere de golpe.
     * Quien la mantiene despues es el propio programador, al cerrar cada
     * ciclo. Aqui se siembra ese estado —plan con meta en 1010— porque lo que
     * se quiere probar es la CARRERA cuando una lectura cruza la meta, no el
     * arranque del plan.
     */
    await prisma.planAsset.updateMany({ where: { planId: porUso.plan.id }, data: { nextDueMeter: 1010 } });
    const lectura = await pedir(BASE, "POST", "/api/readings", c.TECHNICIAN, { meterId: medidor.id, value: 1020 });
    const asignacionMedidor = await prisma.planAsset.findFirst({
      where: { planId: porUso.plan.id }, select: { meterId: true, nextDueMeter: true },
    });
    if (lectura.status >= 300) throw new Error(`La lectura no entró: ${lectura.status} ${JSON.stringify(lectura.json).slice(0, 160)}`);
    const porMedidor = await aLaVez(
      () => pedir(BASE, "POST", "/api/scheduler", c.ADMIN, {}),
      () => pedir(BASE, "POST", "/api/scheduler", c.SUPERVISOR, {}),
    );
    const generadasMedidor = await prisma.workOrder.count({ where: { organizationId: org.id, planId: porUso.plan.id } });
    revisar(
      "Doble generación de una orden por medidor",
      "la lectura que cruza la meta genera UNA orden, aunque el programador corra dos veces",
      generadasMedidor === 1,
      { respuestas: estados(porMedidor), ordenes: generadasMedidor, lectura: lectura.status, asignacion: asignacionMedidor },
    );

    // ═══════════════════════════════ 10. Reintento del mismo evento entrante
    console.log("\n10-12. Reintentos: evento entrante, proceso programado y formulario");
    const { crearCredencial } = await import("../lib/integraciones/credenciales");
    const credencial = await crearCredencial({
      organizationId: org.id, nombre: "Prueba de concurrencia", userId: cuentas.OWNER.id,
      alcances: ["eventos:enviar", "solicitudes:crear"],
    });
    const idempotencia = `evt-${sello}`;
    const evento = {
      tipo: "solicitud",
      datos: { titulo: `Evento repetido ${sello}`, descripcion: "Llega dos veces", codigoActivo: "EQ-1" },
    };
    const enviarEvento = () => pedir(BASE, "POST", "/api/v1/eventos", { Authorization: `Bearer ${credencial.secreto}`, "Idempotency-Key": idempotencia }, evento);
    const primerEnvio = await enviarEvento();
    const reintento = await enviarEvento();
    const solicitudesDelEvento = await prisma.workRequest.count({ where: { organizationId: org.id, title: `Evento repetido ${sello}` } });
    revisar(
      "Reintento del mismo webhook entrante (misma Idempotency-Key)",
      "la segunda no crea otra solicitud: se responde lo mismo que la primera",
      solicitudesDelEvento === 1 && primerEnvio.status < 300 && reintento.status < 300,
      { primera: primerEnvio.status, reintento: reintento.status, solicitudes: solicitudesDelEvento },
    );

    // ═══════════════════════════════ 11. Reintento de un proceso programado
    const { conCandado } = await import("../lib/procesos");
    let corridas = 0;
    const lento = async () => { corridas += 1; await new Promise((r) => setTimeout(r, 400)); return { corridas }; };
    const [p1, p2] = await Promise.all([
      conCandado(`prueba-cron:${sello}`, lento, { organizationId: org.id }),
      new Promise((r) => setTimeout(r, 30)).then(() => conCandado(`prueba-cron:${sello}`, lento, { organizationId: org.id })),
    ]);
    const fila = await prisma.procesoProgramado.findUnique({ where: { clave: `prueba-cron:${sello}` } });
    revisar(
      "Reintento de un proceso programado mientras el primero corre",
      "el segundo se omite; queda constancia de UNA corrida",
      corridas === 1 && [p1.corrio, (p2 as { corrio: boolean }).corrio].filter(Boolean).length === 1 && fila?.corridas === 1,
      { corridas, primera: p1.corrio, segunda: (p2 as { corrio: boolean }).corrio, enLaBase: fila?.corridas },
    );

    // ═══════════════════════════════ 12. Reenvío tras perder la conexión
    // El navegador manda, se cae la red, la persona vuelve a mandar lo mismo.
    const horasPrimera = await pedir(BASE, "POST", `/api/work-orders/${otMaterial.id}/labor`, c.TECHNICIAN, { hours: 2, notes: "Se cayó la red" });
    const horasReenvio = await pedir(BASE, "POST", `/api/work-orders/${otMaterial.id}/labor`, c.TECHNICIAN, { hours: 2, notes: "Se cayó la red" });
    const registros = await prisma.workOrderLabor.count({ where: { workOrderId: otMaterial.id, hours: 2 } });
    revisar(
      "Reenvío del mismo formulario después de perder la conexión",
      "las horas cuentan una vez; el reenvío responde 409 y lo dice",
      registros === 1 && horasPrimera.status === 201 && horasReenvio.status === 409,
      { primera: horasPrimera.status, reenvio: horasReenvio.status, registros, mensaje: horasReenvio.json.error },
    );

    // ═══════════════════════════════ Las demás empresas, intactas
    console.log("");
    revisar(
      "Ninguna de estas carreras tocó datos de otra empresa",
      "los conteos de todas las demás empresas quedan idénticos",
      antes === await fotoDeLasDemas(creadas),
      { antes, despues: await fotoDeLasDemas(creadas) },
    );

    // ── La matriz, para el expediente ──────────────────────────────────────
    console.log("\n\nMATRIZ DE CONCURRENCIA\n");
    console.log("| Caso | Esperado | Real | Estado |");
    console.log("|---|---|---|---|");
    for (const m of matriz) {
      console.log(`| ${m.caso} | ${m.esperado} | ${m.real.replace(/\|/g, "·").slice(0, 150)} | ${m.estado} |`);
    }
  } finally {
    await borrarEmpresas(creadas);
    await prisma.procesoProgramado.deleteMany({ where: { clave: { startsWith: `prueba-cron:${sello}` } } }).catch(() => undefined);
    if (servidor?.pid) { try { process.kill(-servidor.pid); } catch { /* ya cerró */ } }
  }

  console.log(fallas ? `\n${fallas} caso(s) fallaron\n` : "\nLos doce casos, aprobados\n");
}

main()
  .catch((e) => { console.error(e); fallas++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fallas ? 1 : 0); });
