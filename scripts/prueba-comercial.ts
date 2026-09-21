/**
 * Bloque 7 — preparación comercial y cuenta demostrativa.
 *
 * Crea su PROPIA empresa demostrativa (otro slug y otro dominio de correo) y
 * una empresa normal, y ejercita por HTTP, contra `next dev`, lo mismo que
 * hace una persona: las cinco historias de la demo, la restauración, el
 * aislamiento, la solicitud de demostración, la contratación con prueba, el
 * soporte y los documentos. No envía nada fuera: no hay correo conectado y
 * los avisos al celular están apagados en estas empresas.
 *
 *   npx tsx scripts/prueba-comercial.ts
 *
 * Al terminar borra lo que creó y comprueba que las demás empresas quedaron
 * exactamente como estaban.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";

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
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${JSON.stringify(detalle).slice(0, 400)}` : ""}`);
}
async function esperarServidor(base: string, limiteMs: number) {
  const fin = Date.now() + limiteMs;
  while (Date.now() < fin) {
    try { const r = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) }); if (r.status < 500) return; } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`El servidor no respondió en ${limiteMs / 1000} s`);
}
const DIA = 86_400_000;

async function main() {
  const { prisma } = await import("../lib/db");
  const { inicioDe } = await import("../lib/inicio");
  const { PERSONAS, crearEmpresaDemostrativa, resumenDemo, DEMO } = await import("../lib/demo-comercial");
  const { HISTORIAS, PASOS_RECORRIDO } = await import("../lib/demo-guia");
  const { ligasDeHistorias } = await import("../app/(app)/demo/ligas");
  const { PLANES, COMPLEMENTO_IA, ORDEN_PLANES } = await import("../lib/planes");
  const { comparacion, precio, PRUEBA_DIAS } = await import("../lib/comercial");
  const { DOCUMENTOS } = await import("../lib/legal");
  const { emitirCargosDelPeriodo } = await import("../lib/cobranza");
  const { estadoSuscripcion } = await import("../lib/planes");

  let servidor: ChildProcess | null = null;
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3209";
  // Con el alta abierta, para probar la contratación que crea la cuenta. La cerrada se prueba aparte, llamando a la ruta.
  if (!process.env.BASE_URL) servidor = spawn("npx", ["next", "dev", "-p", "3209", "-H", "127.0.0.1"], { stdio: "ignore", detached: true, env: { ...process.env, ALLOW_PUBLIC_SIGNUP: "true" } });

  const sello = `pc-${Date.now()}`;
  const dominio = `${sello}.prueba.mx`;
  const creadas: string[] = [];
  const foto = async () => {
    const where = { organizationId: { notIn: creadas } };
    return JSON.stringify(await Promise.all([
      prisma.organization.count({ where: { id: { notIn: creadas } } }), prisma.workOrder.count({ where }), prisma.workRequest.count({ where }),
      prisma.notification.count({ where: { ...where, user: { isSuperAdmin: false } } }), prisma.stockMovement.count({ where }), prisma.purchaseRequest.count({ where }), prisma.user.count({ where }),
    ]));
  };
  const antes = await foto();

  try {
    // ── Datos: una demo exclusiva de la prueba y una empresa normal con su operador.
    const inicio = Date.now();
    const demo = await crearEmpresaDemostrativa({ contrasena: "prueba-demo-123", slug: `demo-${sello}`, dominio });
    creadas.push(demo.id);
    console.log(`  info  demo sembrada en ${Math.round((Date.now() - inicio) / 1000)} s:`, JSON.stringify(await resumenDemo(demo.id)));
    const B = await prisma.organization.create({ data: { name: `${sello} Normal`, slug: `${sello}-b`, plan: "PROFESSIONAL", status: "ACTIVE", timezone: "America/Monterrey" } });
    creadas.push(B.id);
    const duenoB = await prisma.user.create({ data: { organizationId: B.id, email: `dueno@${dominio}b`, name: "Dueño Normal", role: "OWNER", passwordHash: "x" } });
    // El operador de la plataforma vive en su propia empresa, como en producción.
    const C = await prisma.organization.create({ data: { name: `${sello} Plataforma`, slug: `${sello}-c`, plan: "ENTERPRISE", status: "ACTIVE" } });
    creadas.push(C.id);
    const operador = await prisma.user.create({ data: { organizationId: C.id, email: `operador@${dominio}b`, name: "Operador", role: "OWNER", passwordHash: "x", isSuperAdmin: true } });
    const sitioB = await prisma.site.create({ data: { organizationId: B.id, code: "B1", name: "Planta B" } });
    const activoB = await prisma.asset.create({ data: { organizationId: B.id, siteId: sitioB.id, code: `SECRETO-${sello}`, name: "Equipo de la otra empresa" } });
    const otB = await prisma.workOrder.create({ data: { organizationId: B.id, number: `OTB-${sello}`, title: "Orden de la otra empresa", status: "OPEN" } });

    const du = Object.fromEntries(await Promise.all(PERSONAS.map(async (p) => [p.clave, await prisma.user.findUniqueOrThrow({ where: { email: `${p.clave}@${dominio}` } })]))) as Record<(typeof PERSONAS)[number]["clave"], { id: string; email: string; name: string; role: string; organizationId: string }>;
    const w = { organizationId: demo.id };

    // ═══════════════════════════════════════════ 1-9. La demo está limpia y es coherente
    console.log("\n1-9. Cuenta demo limpia y coherente");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: demo.id } });
    revisar("1. identificada como «Empresa demostrativa», marcada demo, activa, sin prueba ni cargos", org.name === DEMO.nombre && org.esDemo && org.status === "ACTIVE" && !org.trialEndsAt && (await prisma.invoice.count({ where: w })) === 0);
    const activos = await prisma.asset.findMany({ where: w, include: { location: true } });
    revisar("2. entre 10 y 15 activos, con criticidades A, B y C, todos con ubicación del sitio", activos.length >= 10 && activos.length <= 15 && ["A", "B", "C"].every((c) => activos.some((a) => a.criticality === c)) && activos.every((a) => a.location && a.location.siteId === a.siteId), activos.length);
    const ubic = await prisma.location.findMany({ where: w });
    revisar("3. ubicaciones coherentes: todas del sitio y con activos; margen solo en la línea", ubic.every((l) => activos.some((a) => a.locationId === l.id)) && ubic.filter((l) => l.margenPorHora > 0).every((l) => l.name.startsWith("Línea")));
    const planes = await prisma.maintenancePlan.findMany({ where: w, include: { tasks: true, asignaciones: true } });
    revisar("4. planes completos: cada uno con actividades, equipo asignado y responsable; los de horas con medidor", planes.length === 10 && planes.every((p) => p.tasks.length > 0 && p.asignaciones.length > 0 && p.assignedToId) && planes.filter((p) => p.triggerType === "METER").every((p) => p.asignaciones.every((a) => a.meterId)), planes.length);
    const partes = await prisma.part.findMany({ where: w, include: { existencias: true } });
    const movs = await prisma.stockMovement.findMany({ where: w, orderBy: { createdAt: "asc" } });
    const cuadra = partes.every((p) => {
      const suma = p.existencias.reduce((s, x) => s + x.quantity, 0);
      const kardex = movs.filter((m) => m.partId === p.id).reduce((s, m) => s + (["IN", "RETURN", "TRANSFER_IN"].includes(m.movementType) ? m.quantity : -m.quantity), 0);
      return Math.abs(suma - p.quantityOnHand) < 1e-6 && Math.abs(kardex - suma) < 1e-6 && suma >= 0;
    });
    revisar("5. inventario: nada negativo; existencia = almacén = suma del kardex, en orden cronológico", cuadra && movs.every((m, i) => i === 0 || m.createdAt >= movs[i - 1].createdAt) && movs.every((m) => m.createdAt <= new Date()));
    const cerradas = await prisma.workOrder.findMany({ where: { ...w, status: "CLOSED" }, include: { labor: true, partsUsed: true, servicesUsed: true } });
    revisar("6. costos: cada OT cerrada con mano de obra, total = mano de obra + refacciones + servicios, y ninguno absurdo (< $20,000)",
      cerradas.every((o) => o.labor.length > 0 && Math.abs(o.totalCost - (o.laborCost + o.partsCost + o.serviceCost + o.otherCost)) < 0.01 && o.totalCost > 0 && o.totalCost < 20_000), cerradas.map((o) => o.totalCost).slice(0, 5));
    const ahora = new Date();
    revisar("7. OT cerradas con solución, fechas en orden y en el pasado; correctivos con falla y causa; preventivos con su plan",
      cerradas.every((o) => o.resolution && o.createdAt <= o.startedAt! && o.startedAt! <= o.completedAt! && o.completedAt! <= o.closedAt! && o.closedAt! <= ahora)
      && cerradas.filter((o) => o.maintenanceType === "CORRECTIVE").every((o) => o.failureCodeId && o.rootCauseId)
      && cerradas.filter((o) => o.maintenanceType === "PREVENTIVE").every((o) => o.planId)
      && new Set(cerradas.filter((o) => o.maintenanceType === "CORRECTIVE").map((o) => o.resolution)).size === cerradas.filter((o) => o.maintenanceType === "CORRECTIVE").length);
    const dueno = await prisma.user.findUniqueOrThrow({ where: { id: du.direccion.id }, include: { organization: true } });
    const inicioDueno = await inicioDe(dueno as never) as { resumen: Array<{ etiqueta: string; valor: string }>; bloques: Array<{ id: string; total: number }> };
    const valor = (e: string) => inicioDueno.resumen.find((r) => r.etiqueta.startsWith(e))?.valor ?? "";
    const disp = Number(valor("Disponibilidad").replace(/[^\d.]/g, ""));
    const cumpl = Number(valor("Cumplimiento").replace(/[^\d.]/g, ""));
    revisar("8. indicadores creíbles: 2 OT vencidas, disponibilidad entre 95 y 99.9 %, cumplimiento entre 60 y 99 %, costo del mes positivo",
      valor("OT vencidas") === "2" && disp >= 95 && disp < 100 && cumpl >= 60 && cumpl < 100 && /\$[\d,]+/.test(valor("Costo")), inicioDueno.resumen);
    const emision = await emitirCargosDelPeriodo(new Date().toISOString().slice(0, 7), { organizationId: demo.id });
    revisar("9. sin cargos: la emisión de cobranza la omite por ser demo", emision.emitidos === 0 && emision.omitidos.some((o) => /demostrativa/.test(o.motivo)) && (await prisma.invoice.count({ where: w })) === 0, emision.omitidos);
    const usuarios = await prisma.user.findMany({ where: w });
    revisar("   usuarios con nombre y puesto propios, sin genéricos ni correos reales", usuarios.length === 8 && usuarios.every((x) => x.jobTitle && !/prueba|test|usuario|técnico \d/i.test(x.name) && x.email.endsWith(`@${dominio}`)));
    const compras = await prisma.purchaseRequest.findMany({ where: w, include: { renglones: true, ordenes: true } });
    revisar("   compras con proveedor y sin recibir más de lo pedido", compras.every((c) => c.proveedorSugeridoId || c.ordenes.length) && compras.every((c) => c.renglones.every((r) => r.cantidadRecibida <= r.cantidadSolicitada)));
    const lecturas = await prisma.meterReading.findMany({ where: w, orderBy: [{ meterId: "asc" }, { readingAt: "asc" }] });
    revisar("   lecturas de medidor crecientes y ninguna en el futuro", lecturas.every((l, i) => i === 0 || l.meterId !== lecturas[i - 1].meterId || l.value >= lecturas[i - 1].value) && lecturas.every((l) => l.readingAt <= new Date(Date.now() + 60_000)));
    // Los registros que usa cada historia existen.
    const faltan: string[] = [];
    for (const h of HISTORIAS) for (const r of h.registros) {
      const hay = r.tipo === "ruta" ? true : r.tipo === "activo" ? await prisma.asset.count({ where: { ...w, code: r.clave } }) : r.tipo === "solicitud" ? await prisma.workRequest.count({ where: { ...w, number: r.clave } }) : r.tipo === "refaccion" ? await prisma.part.count({ where: { ...w, code: r.clave } }) : await prisma.workOrder.count({ where: { ...w, number: r.clave } });
      if (!hay) faltan.push(`${h.clave}:${r.clave}`);
    }
    revisar("   cada registro que nombra la guía de la demo existe", faltan.length === 0, faltan);

    await esperarServidor(base, 240_000);
    const secreto = new TextEncoder().encode(process.env.AUTH_SECRET!);
    const cookie = async (x: { id: string; organizationId: string; email: string; name: string; role: string }) =>
      ({ Cookie: `mt_session=${await new SignJWT({ userId: x.id, organizationId: x.organizationId, email: x.email, name: x.name, role: x.role }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secreto)}` });
    const c = Object.fromEntries(await Promise.all(Object.entries(du).map(async ([k, v]) => [k, await cookie(v)]))) as Record<keyof typeof du, Record<string, string>>;
    const cB = await cookie(duenoB), cOp = await cookie(operador);
    const pedir = async (metodo: string, ruta: string, cab: Record<string, string>, cuerpo?: unknown) => {
      const r = await fetch(`${base}${ruta}`, { method: metodo, headers: { "Content-Type": "application/json", ...cab }, redirect: "manual", ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}), signal: AbortSignal.timeout(180_000) });
      const texto = await r.text();
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(texto); } catch { /* html */ }
      return { status: r.status, json, texto, cookie: r.headers.get("set-cookie") };
    };
    const falla = { FUG: (await prisma.failureCode.findFirstOrThrow({ where: { ...w, code: "FUGA-01" } })).id };
    const causa = { DN: (await prisma.rootCause.findFirstOrThrow({ where: { ...w, code: "FIN-VIDA-UTIL" } })).id };
    revisar("   catálogos sin duplicados: un solo código de fuga y cada código una vez", (await prisma.failureCode.count({ where: { ...w, description: { contains: "Fuga" } } })) === 1
      && new Set((await prisma.failureCode.findMany({ where: w })).map((f) => f.code)).size === (await prisma.failureCode.count({ where: w })));

    // ═══════════════════════════════════════════ 10. Historia correctiva
    console.log("\n10. Historia 1: una falla, de principio a fin");
    const lln = activos.find((a) => a.code === "LLN-101")!;
    const costoAntes = (await prisma.workOrder.aggregate({ where: { ...w, assetId: lln.id }, _sum: { totalCost: true } }))._sum.totalCost ?? 0;
    const sol = await prisma.workRequest.findFirstOrThrow({ where: { ...w, number: "SS-000001" } });
    const misReportes = await pedir("GET", "/requests", c.operador);
    const aprobada = await pedir("POST", `/api/requests/${sol.id}`, c.supervision, { action: "APPROVE", tipo: "FALLA", assignedToId: du.mecanico.id, reviewNotes: "Se atiende hoy." });
    const otS = await prisma.workOrder.findFirstOrThrow({ where: { ...w, requests: { some: { id: sol.id } } }, include: { tasks: true } }).catch(async () => prisma.workOrder.findFirstOrThrow({ where: { ...w, id: (await prisma.workRequest.findUniqueOrThrow({ where: { id: sol.id } })).workOrderId! }, include: { tasks: true } }));
    const pasos1 = [
      await pedir("POST", `/api/work-orders/${otS.id}/aceptar`, c.mecanico),
      await pedir("POST", `/api/work-orders/${otS.id}/status`, c.mecanico, { status: "IN_PROGRESS" }),
      ...(await Promise.all(otS.tasks.map((t) => pedir("PATCH", `/api/work-orders/${otS.id}/tasks`, c.mecanico, { taskId: t.id, done: true })))),
      await pedir("POST", `/api/work-orders/${otS.id}/labor`, c.mecanico, { hours: 1, notes: "Cambio de empaques de la válvula 18" }),
      await pedir("POST", `/api/work-orders/${otS.id}/parts`, c.mecanico, { partId: partes.find((p) => p.code === "KIT-VLL")!.id, quantity: 1 }),
      await pedir("POST", `/api/work-orders/${otS.id}/status`, c.mecanico, { status: "COMPLETED", resolution: "Se cambiaron los empaques de la válvula 18; sin fuga en 200 botellas.", fallas: otS.tasks.filter((t) => (t.maintenanceType ?? otS.maintenanceType) === "CORRECTIVE").map((t) => ({ taskId: t.id, failureCodeId: falla.FUG, rootCauseId: causa.DN, downtimeMinutes: 20 })), sinParoConfirmado: false }),
      await pedir("POST", `/api/work-orders/${otS.id}/status`, c.supervision, { status: "CLOSED" }),
    ];
    const otFinal = await prisma.workOrder.findUniqueOrThrow({ where: { id: otS.id } });
    const costoDespues = (await prisma.workOrder.aggregate({ where: { ...w, assetId: lln.id }, _sum: { totalCost: true } }))._sum.totalCost ?? 0;
    const expediente = await pedir("GET", `/assets/${lln.id}`, c.supervision);
    revisar("el operador ve su reporte; supervisión lo convierte en OT asignada; el técnico acepta, ejecuta, carga material y tiempo, y termina; supervisión cierra",
      misReportes.status === 200 && misReportes.texto.includes("Gotea producto") && aprobada.status < 300 && pasos1.every((p) => p.status < 300) && otFinal.status === "CLOSED" && otFinal.assetId === lln.id,
      pasos1.map((p) => `${p.status}${p.status >= 300 ? ` ${JSON.stringify(p.json).slice(0, 120)}` : ""}`));
    revisar("el costo (1 h + kit de empaques) queda en la OT y en el expediente del activo, con la falla", otFinal.totalCost > 1000 && Math.round(costoDespues - costoAntes) === Math.round(otFinal.totalCost) && expediente.texto.includes(otFinal.number), { costo: otFinal.totalCost, antes: costoAntes, despues: costoDespues });
    /**
     * El inicio muestra un resumen que se recalcula cada cuarto de hora
     * (lib/resumen-inicio.ts), asi que cerrar una orden no mueve la cifra en
     * el acto. Lo que se ejercita aqui es el camino completo: cerrar,
     * actualizar —lo mismo que hace el boton «Actualizar» de la pantalla— y
     * ver la cifra nueva.
     */
    const { olvidarResumen } = await import("../lib/resumen-inicio");
    await olvidarResumen(demo.id);
    const inicio2 = await inicioDe(dueno as never) as typeof inicioDueno;
    const costoMes = (r: typeof inicioDueno) => Number((r.resumen.find((x) => x.etiqueta.startsWith("Costo"))?.valor ?? "0").replace(/[^\d.]/g, ""));
    revisar("al actualizar el inicio, el costo de mantenimiento del mes sube exactamente lo de la orden", Math.round(costoMes(inicio2) - costoMes(inicioDueno)) === Math.round(otFinal.totalCost), { antes: costoMes(inicioDueno), despues: costoMes(inicio2) });

    // ═══════════════════════════════════════════ 11. Historia preventiva
    console.log("\n11. Historia 2: el preventivo que se programa solo");
    const plan = planes.find((p) => p.name.startsWith("Lubricación y revisión"))!;
    const otP = await prisma.workOrder.findFirstOrThrow({ where: { ...w, planId: plan.id, status: "ASSIGNED" }, include: { tasks: true } });
    const pa0 = await prisma.planAsset.findFirstOrThrow({ where: { planId: plan.id } });
    const cumplAntes = cumpl;
    const pasos2 = [
      await pedir("POST", `/api/work-orders/${otP.id}/status`, c.mecanico, { status: "IN_PROGRESS" }),
      ...(await Promise.all(otP.tasks.map((t) => pedir("PATCH", `/api/work-orders/${otP.id}/tasks`, c.mecanico, t.taskType === "MEASUREMENT" ? { taskId: t.id, done: true, resultNumber: 2.1 } : { taskId: t.id, done: true })))),
      await pedir("POST", `/api/work-orders/${otP.id}/labor`, c.mecanico, { hours: 1.5 }),
      await pedir("POST", `/api/work-orders/${otP.id}/status`, c.mecanico, { status: "COMPLETED", resolution: "Rutina completa; presión de llenado 2.1 bar.", sinParoConfirmado: false, downtimeMinutes: 90 }),
      await pedir("POST", `/api/work-orders/${otP.id}/status`, c.supervision, { status: "CLOSED" }),
    ];
    const pa1 = await prisma.planAsset.findFirstOrThrow({ where: { planId: plan.id } });
    const inicio3 = await inicioDe(dueno as never) as typeof inicioDueno;
    const cumplDespues = Number((inicio3.resumen.find((r) => r.etiqueta.startsWith("Cumplimiento"))?.valor ?? "").replace(/[^\d.]/g, ""));
    revisar("la OT generada por el plan se ejecuta con lista de verificación y medición, y se cierra", pasos2.every((p) => p.status < 300) && (await prisma.workOrder.findUniqueOrThrow({ where: { id: otP.id } })).status === "CLOSED", pasos2.map((p) => `${p.status}${p.status >= 300 ? ` ${JSON.stringify(p.json).slice(0, 150)}` : ""}`));
    revisar("el plan registra la ejecución y el cumplimiento no baja", (pa1.lastCompletedAt?.getTime() ?? 0) > (pa0.lastCompletedAt?.getTime() ?? 0) && cumplDespues >= cumplAntes, { antes: pa0.lastCompletedAt, despues: pa1.lastCompletedAt, cumplAntes, cumplDespues });

    // ═══════════════════════════════════════════ 12. Historia por condición
    console.log("\n12. Historia 3: por uso y por condición");
    const alerta = await prisma.predictiveAlert.findFirstOrThrow({ where: { ...w, status: "OPEN" }, include: { sensor: true } });
    const conOT = await pedir("POST", `/api/alerts/${alerta.id}`, c.supervision, { action: "CREATE_WORK_ORDER" });
    const otA = await prisma.workOrder.findFirstOrThrow({ where: { id: (await prisma.predictiveAlert.findUniqueOrThrow({ where: { id: alerta.id } })).workOrderId! }, include: { tasks: true } });
    const pasos3 = [
      await pedir("PATCH", `/api/work-orders/${otA.id}`, c.supervision, { assignedToId: du.mecanico.id, base: { assignedToId: otA.assignedToId ?? "" } }),
      await pedir("POST", `/api/work-orders/${otA.id}/status`, c.mecanico, { status: "IN_PROGRESS" }),
      ...(await Promise.all(otA.tasks.map((t) => pedir("PATCH", `/api/work-orders/${otA.id}/tasks`, c.mecanico, { taskId: t.id, done: true })))),
      await pedir("POST", `/api/work-orders/${otA.id}/labor`, c.mecanico, { hours: 2 }),
      await pedir("POST", `/api/work-orders/${otA.id}/status`, c.mecanico, { status: "COMPLETED", resolution: "Se lavó el enfriador de aceite; la temperatura bajó a 83 °C.", motivoSinDiagnostico: "Mantenimiento por condición, antes de la falla", sinParoConfirmado: true }),
    ];
    const lectura = await pedir("POST", "/api/sensors/readings", c.supervision, { sensorId: alerta.sensorId, value: 83 });
    const normal = await pedir("POST", `/api/alerts/${alerta.id}`, c.supervision, { action: "VALIDATE_NORMALIZATION", nota: "Enfriador lavado" });
    const alertaFin = await prisma.predictiveAlert.findUniqueOrThrow({ where: { id: alerta.id } });
    const mon = await prisma.meter.findFirstOrThrow({ where: { ...w, asset: { code: "MON-301" } } });
    const paMon = await prisma.planAsset.findFirstOrThrow({ where: { meterId: mon.id } });
    const otMon = await prisma.workOrder.count({ where: { ...w, asset: { code: "MON-301" }, status: { notIn: ["CLOSED", "CANCELLED"] } } });
    revisar("la alerta del compresor genera su OT; se atiende; la lectura vuelve a lo normal y la alerta se cierra",
      conOT.status < 300 && pasos3.every((p) => p.status < 300) && lectura.status < 300 && normal.status < 300 && alertaFin.status !== "OPEN",
      { conOT: conOT.status, pasos3: pasos3.map((p) => `${p.status}${p.status >= 300 ? ` ${JSON.stringify(p.json).slice(0, 120)}` : ""}`), lectura: lectura.status, normal: `${normal.status} ${JSON.stringify(normal.json).slice(0, 160)}`, estado: alertaFin.status });
    revisar("por uso: el montacargas está a menos de 50 h de su servicio y su OT ya se generó", (paMon.nextDueMeter ?? 0) - mon.currentValue > 0 && (paMon.nextDueMeter ?? 0) - mon.currentValue < 50 && otMon === 1, { faltan: (paMon.nextDueMeter ?? 0) - mon.currentValue, otMon });

    // ═══════════════════════════════════════════ 13. Historia de inventario y compras
    console.log("\n13. Historia 4: inventario y compras");
    const sep = partes.find((p) => p.code === "FIL-SEP")!;
    const almacen = await prisma.warehouse.findFirstOrThrow({ where: w });
    const detenida = await prisma.workOrder.findFirstOrThrow({ where: { ...w, status: "ON_HOLD" }, include: { tasks: true } });
    const provAire = await prisma.supplier.findFirstOrThrow({ where: { ...w, name: { contains: "Aire" } } });
    const nueva = await pedir("POST", "/api/compras", c.compras, { warehouseId: almacen.id, proveedorSugeridoId: provAire.id, urgencia: "ALTA", justificacion: "Detiene el cambio de aceite del compresor", renglones: [{ partId: sep.id, descripcion: sep.name, cantidadSolicitada: 2, costoEstimado: 4800 }] });
    const idC = ((nueva.json.compra ?? nueva.json.solicitud ?? nueva.json) as { id?: string }).id ?? (await prisma.purchaseRequest.findFirstOrThrow({ where: w, orderBy: { createdAt: "desc" } })).id;
    const noFirma = await pedir("POST", `/api/compras/${idC}`, c.compras, { accion: "AUTORIZAR" });
    const firma = await pedir("POST", `/api/compras/${idC}`, c.direccion, { accion: "AUTORIZAR" });
    const renglon = await prisma.purchaseRequestLine.findFirstOrThrow({ where: { requestId: idC } });
    const cot = await pedir("POST", `/api/compras/${idC}/cotizaciones`, c.compras, { accion: "COTIZAR", supplierId: provAire.id, diasEntrega: 2, renglones: [{ requestLineId: renglon.id, partId: sep.id, descripcion: sep.name, cantidad: 2, costoUnitario: 4750, disponible: true }] });
    const eleg = await pedir("POST", `/api/compras/${idC}/cotizaciones`, c.compras, { accion: "ELEGIR", quoteId: (cot.json as { id: string }).id });
    const emit = await pedir("POST", `/api/compras/${idC}/cotizaciones`, c.compras, { accion: "EMITIR" });
    const recibe = await pedir("POST", `/api/compras/${idC}`, c.compras, { accion: "RECIBIR", clave: `rec-${sello}`, remision: "R-900", renglones: [{ requestLineId: renglon.id, partId: sep.id, cantidad: 2, costoUnitario: 4750, conforme: true }] });
    const sepFin = await prisma.part.findUniqueOrThrow({ where: { id: sep.id } });
    const entrada = await prisma.stockMovement.findFirst({ where: { ...w, partId: sep.id, movementType: "IN" }, orderBy: { createdAt: "desc" } });
    revisar("bajo mínimo → requisición → Compras no firma, Dirección sí → cotización, orden y recepción → kardex con la entrada y su costo",
      nueva.status === 201 && noFirma.status === 403 && firma.status < 300 && cot.status === 201 && eleg.status < 300 && emit.status < 300 && recibe.status < 300 && sepFin.quantityOnHand === 2 && entrada?.quantity === 2 && Math.round(sepFin.unitCost) === 4750,
      { nueva: nueva.status, noFirma: noFirma.status, firma: firma.status, cot: cot.status, eleg: eleg.status, emit: `${emit.status} ${JSON.stringify(emit.json).slice(0, 100)}`, recibe: `${recibe.status} ${JSON.stringify(recibe.json).slice(0, 100)}`, existencia: sepFin.quantityOnHand });
    const reanuda = await pedir("POST", `/api/work-orders/${detenida.id}/status`, c.supervision, { status: detenida.startedAt ? "IN_PROGRESS" : "ASSIGNED" });
    const consumo = await pedir("POST", `/api/work-orders/${detenida.id}/parts`, c.mecanico, { partId: sep.id, quantity: 1 });
    const detFin = await prisma.workOrder.findUniqueOrThrow({ where: { id: detenida.id } });
    revisar("la OT detenida se reanuda, toma la refacción del almacén y su costo refleja el precio de compra", reanuda.status < 300 && consumo.status < 300 && Math.round(detFin.partsCost) === 4750, { reanuda: `${reanuda.status} ${JSON.stringify(reanuda.json).slice(0, 100)}`, consumo: consumo.status, costo: detFin.partsCost });

    // ═══════════════════════════════════════════ 14. Historia directiva
    console.log("\n14. Historia 5: lo que ve la dirección");
    const paginas = await Promise.all(["/dashboard", "/indicadores", "/paros", "/reports"].map((r) => pedir("GET", r, c.direccion)));
    revisar("la dirección abre inicio, indicadores, Dónde para la planta y reportes con datos de la demo", paginas.every((p) => p.status === 200 && !p.texto.includes("Esta pantalla no es de su rol")) && paginas[2].texto.includes("LLN-101"), paginas.map((p) => p.status));
    revisar("en su inicio: situación crítica, OT vencidas (la caldera entre ellas) y la compra que espera su firma", inicioDueno.bloques.some((b) => b.id === "situacion-critica" && b.total > 0) && paginas[0].texto.includes("RC-000002") && (await prisma.workOrder.count({ where: { ...w, dueDate: { lt: ahora }, status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] }, asset: { code: "CAL-203" } } })) === 1);

    // ═══════════════════════════════════════════ 15. Restauración
    console.log("\n15. Restauración de la demo");
    const previa = await pedir("GET", "/api/demo/restaurar", c.direccion);
    const sinPalabra = await pedir("POST", "/api/demo/restaurar", c.direccion, { confirmacion: "si" });
    const tecnicoNo = await pedir("POST", "/api/demo/restaurar", c.mecanico, { confirmacion: "RESTAURAR" });
    const otraNo = await pedir("POST", "/api/demo/restaurar", cB, { confirmacion: "RESTAURAR" });
    const tB0 = await foto();
    const [r1, r2, durante] = await Promise.all([
      pedir("POST", "/api/demo/restaurar", c.direccion, { confirmacion: "RESTAURAR" }),
      new Promise((r) => setTimeout(r, 150)).then(() => pedir("POST", "/api/demo/restaurar", c.gerencia, { confirmacion: "RESTAURAR" })),
      new Promise((r) => setTimeout(r, 300)).then(() => pedir("GET", "/api/notifications", c.supervision)),
    ]);
    const tras = await resumenDemo(demo.id);
    const sol1 = await prisma.workRequest.findFirst({ where: { ...w, number: "SS-000001" } });
    const sepR = await prisma.part.findFirst({ where: { ...w, code: "FIL-SEP" } });
    const bitacora = await prisma.auditLog.findFirst({ where: { ...w, action: "DEMO_RESTORED" } });
    revisar("la vista previa dice qué se conserva y qué se restaura; sin la palabra, un técnico u otra empresa: rechazado",
      previa.status === 200 && Array.isArray(previa.json.seConserva) && sinPalabra.status === 422 && tecnicoNo.status === 403 && otraNo.status === 403, { previa: previa.status, sinPalabra: sinPalabra.status, tecnicoNo: tecnicoNo.status, otraNo: otraNo.status });
    revisar("restaura una vez: una segunda simultánea se rechaza y, mientras corre, la demo responde «se está restaurando»",
      r1.status === 200 && [409, 503].includes(r2.status) && [200, 503].includes((durante as { status: number }).status), { r1: `${r1.status} ${JSON.stringify(r1.json).slice(0, 100)}`, r2: r2.status, durante: (durante as { status: number }).status });
    revisar("vuelve al estado inicial (la solicitud pendiente, el separador agotado, 13 activos) y queda en la auditoría; las demás empresas intactas",
      tras.activos === 13 && sol1?.status === "PENDING" && sepR?.quantityOnHand === 0 && !!bitacora && tB0 === await foto() && (await prisma.user.count({ where: w })) === 8, tras);
    const orgR = await prisma.organization.findUniqueOrThrow({ where: { id: demo.id } });
    revisar("   conserva la empresa y sus cuentas, y suelta el candado", orgR.esDemo && !orgR.demoRestaurandoDesde && !!orgR.demoRestauradaAt);

    // ═══════════════════════════════════════════ 16. Guía y recorrido
    console.log("\n16. Guía de la demostración y recorrido");
    const guia = await pedir("GET", "/demo", c.supervision);
    const guiaNormal = await pedir("GET", "/demo", cB);
    const conBanda = await pedir("GET", "/dashboard", c.mecanico);
    revisar("la guía existe en la demo, con sus 5 historias; en una empresa normal no", guia.status === 200 && HISTORIAS.every((h) => guia.texto.includes(h.titulo)) && !guiaNormal.texto.includes(HISTORIAS[0].titulo));
    revisar("la demo lleva la banda «Empresa demostrativa» y el recorrido señala 10 pantallas reales, en orden", conBanda.texto.includes("Empresa demostrativa") && PASOS_RECORRIDO.length === 10 && PASOS_RECORRIDO.map((p) => p.href).join() === "/dashboard,/assets,/work-orders,/plans,/alerts,/inventory,/compras,/indicadores,/paros,/puesta-en-marcha");
    const rutasRecorrido = await Promise.all(PASOS_RECORRIDO.map((p) => pedir("GET", p.href, c.direccion)));
    revisar("   cada paso del recorrido abre sin error para la dirección", rutasRecorrido.every((r) => r.status === 200 && !r.texto.includes("Esta pantalla no es de su rol")), rutasRecorrido.map((r) => r.status));

    // ═══════════════════════════════════════════ 16b. Presentación al cliente
    console.log("\n16b. Presentación al cliente");
    const { armarPresentacion } = await import("../lib/demo-presentacion");
    const cubierta = armarPresentacion();
    const pres = await pedir("GET", "/demo/presentacion", c.direccion);
    const presNormal = await pedir("GET", "/demo/presentacion", cB);
    revisar("la presentación existe en la demo y en una empresa normal no se llega a ella",
      pres.status === 200 && presNormal.texto.includes("Esta pantalla no es de su rol") && !presNormal.texto.includes(cubierta[0].titulo),
      { demo: pres.status, normal: presNormal.status });
    revisar(`   trae las ${cubierta.length} diapositivas, con la portada, los 5 casos, la IA, los precios y el cierre`,
      cubierta.length >= 16
      && cubierta[0].clave === "portada" && cubierta[cubierta.length - 1].clave === "gracias"
      && HISTORIAS.every((h) => cubierta.some((d) => d.clave === `caso-${h.clave}`))
      && ["ia", "precios", "implementacion"].every((k) => cubierta.some((d) => d.clave === k))
      && pres.texto.includes(cubierta[0].titulo));
    // Los precios y los límites salen de lib/planes.ts: si alguien los escribe a
    // mano en una diapositiva, la presentación y el sitio dirán cosas distintas
    // delante del cliente.
    const { PLANES: PL } = await import("../lib/planes");
    const diaPrecios = cubierta.find((d) => d.clave === "precios")!;
    const bloquePlanes = diaPrecios.bloques.find((b) => b.tipo === "planes");
    revisar("   los precios de la presentación son los de los planes, sin escribirlos a mano",
      bloquePlanes?.tipo === "planes" && bloquePlanes.items.length === 2
      && bloquePlanes.items[0].precio.includes(PL.PROFESSIONAL.precioMensual.toLocaleString("es-MX"))
      && bloquePlanes.items[1].precio.includes(PL.ENTERPRISE.precioMensual.toLocaleString("es-MX")));
    // Un botón que lleva a «Sin permiso» delante del cliente es peor que no tenerlo.
    const conLigas = armarPresentacion(await ligasDeHistorias(demo.id, "OWNER"));
    const ligasCasos = conLigas.filter((d) => d.clave.startsWith("caso-")).flatMap((d) => d.ligas ?? []);
    const abiertas = await Promise.all(ligasCasos.map((l) => pedir("GET", l.href, c.direccion)));
    revisar(`   los ${ligasCasos.length} botones de los casos abren pantallas reales de esta demo`,
      ligasCasos.length >= 20 && abiertas.every((r) => r.status === 200 && !r.texto.includes("Esta pantalla no es de su rol")),
      abiertas.map((r, i) => `${ligasCasos[i].href}:${r.status}`).filter((x) => !x.endsWith(":200")));
    const paraTecnico = armarPresentacion(await ligasDeHistorias(demo.id, "TECHNICIAN"));
    revisar("   a un rol sin acceso no se le ofrecen: el técnico no ve el botón de compras ni el de indicadores",
      !paraTecnico.flatMap((d) => d.ligas ?? []).some((l) => l.href === "/compras" || l.href === "/indicadores"));

    // ═══════════════════════════════════════════ 17-21. Planes, precios, límites, prueba y cambio de plan
    console.log("\n17-21. Planes, precios y cambios");
    const sitio = await pedir("GET", "/", {});
    const contratar = await pedir("GET", "/contratar?plan=ENTERPRISE", {});
    const ajustes = await pedir("GET", "/settings?s=planes", cB);
    const precios = [...ORDEN_PLANES.map((p) => precio(PLANES[p].precioMensual, PLANES[p].moneda)), precio(COMPLEMENTO_IA.precioMensual)];
    revisar("17. la comparación sale de los planes: límites de usuarios, activos y sitios iguales a los que aplica el sistema", comparacion().filter((f) => ["Usuarios", "Activos", "Sitios"].includes(f.concepto)).every((f) => ORDEN_PLANES.every((p) => {
      const cel = f.celdas[p]; const lim = PLANES[p].limites[f.concepto === "Usuarios" ? "users" : f.concepto === "Activos" ? "assets" : "sites"];
      return cel.tipo === "limite" && cel.valor === (lim === Infinity ? "Sin límite" : lim.toLocaleString("es-MX"));
    })));
    revisar("18. el mismo precio en el sitio, la contratación y la suscripción", precios.every((p) => sitio.texto.includes(p) && contratar.texto.includes(p.replace(/ MXN$/, ""))) && ajustes.status === 200, { precios, sitio: sitio.status, contratar: contratar.status });
    const textosPlan = sitio.texto + contratar.texto;
    revisar("19. sin promesas ambiguas ni inexistentes en el sitio (IoT completo, ERP, garantías, «funciones avanzadas», «más contratado»)", !/plataforma IoT completa|sustituye (a |al )?(su )?ERP|garantiza|funciones avanzadas|más contratado/i.test(textosPlan.replace(/No (es una plataforma IoT completa|garantiza que no habrá fallas)/g, "")));
    const periodo = new Date().toISOString().slice(0, 7);

    // ═══════════════════════════════════════════ 22. Solicitud de demostración
    console.log("\n22. Solicitud de demostración");
    // El freno por dirección ahora se cuenta EN LA BASE, no en memoria del
    // proceso (era de cinco por instancia de Cloud Run, o sea cincuenta por
    // hora). Eso hace que el conteo sobreviva entre corridas de esta prueba:
    // sin limpiarlo, la segunda corrida de la hora arranca ya frenada.
    await prisma.limiteUso.deleteMany({ where: { clave: { startsWith: "prospectos:" } } }).catch(() => undefined);
    const ip = { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 200)}.1` };
    const datos = { nombre: "Laura Prueba", empresa: `${sello} Envases`, correo: `laura@${dominio}`, telefono: "81 5555 0000", tipoInstalacion: "PLANTA", rangoActivos: "51-200", problema: "Los preventivos se atrasan", aceptaPrivacidad: true };
    const d1 = await pedir("POST", "/api/prospectos", ip, datos);
    const d2 = await pedir("POST", "/api/prospectos", ip, { ...datos, nombre: "Laura P." });
    const sinAviso = await pedir("POST", "/api/prospectos", ip, { ...datos, correo: `otra@${dominio}`, aceptaPrivacidad: false });
    const malCorreo = await pedir("POST", "/api/prospectos", ip, { ...datos, correo: "no-es-correo" });
    const robot = await pedir("POST", "/api/prospectos", ip, { ...datos, correo: `robot@${dominio}`, sitioWeb: "http://spam" });
    const prospectos = await prisma.prospecto.findMany({ where: { correo: { endsWith: `@${dominio}` } } });
    const avisoOp = await prisma.notification.count({ where: { userId: operador.id, title: { contains: `${sello} Envases` } } });
    let limite = 0;
    for (let i = 0; i < 6; i++) limite = (await pedir("POST", "/api/prospectos", { "x-forwarded-for": "10.250.0.9" }, { ...datos, correo: `lim${i}@${dominio}` })).status;
    revisar("válida → 201; repetida el mismo día → no se duplica; sin aceptar privacidad o con correo inválido → 422; robot → no se guarda; más de 5 por hora → 429",
      d1.status === 201 && d2.status === 200 && d2.json.duplicado === true && sinAviso.status === 422 && malCorreo.status === 422 && robot.status === 201 && prospectos.filter((p) => p.correo === `laura@${dominio}`).length === 1 && !prospectos.some((p) => p.correo.startsWith("robot@")) && limite === 429,
      { d1: d1.status, d2: d2.status, sinAviso: sinAviso.status, malCorreo: malCorreo.status, robot: robot.status, limite });
    const p1 = prospectos.find((p) => p.correo === `laura@${dominio}`)!;
    revisar("   con origen, fecha y versión del aviso; el operador recibe el aviso en la campana", p1.origen === "SITIO" && !!p1.createdAt && !!p1.avisoPrivacidad && avisoOp === 1);
    const perdidaSin = await pedir("PATCH", `/api/admin/prospectos/${p1.id}`, cOp, { estado: "PERDIDA" });
    const perdida = await pedir("PATCH", `/api/admin/prospectos/${p1.id}`, cOp, { estado: "PERDIDA", motivoPerdida: "Precio" });
    const noOperador = await pedir("PATCH", `/api/admin/prospectos/${p1.id}`, c.direccion, { estado: "GANADA" });
    const pantallaP = await pedir("GET", "/clients/prospectos", cOp);
    revisar("   seguimiento interno: perder pide motivo; solo el operador lo cambia; la lista lo muestra", perdidaSin.status === 422 && perdida.status === 200 && noOperador.status === 403 && pantallaP.texto.includes(`${sello} Envases`));

    // ═══════════════════════════════════════════ 23-25, 20. Contratación, alta, puesta en marcha y prueba
    console.log("\n20, 23-25. Contratación en línea, prueba y puesta en marcha");
    const contrato = { plan: "PROFESSIONAL", complementoIa: true, empresa: `${sello} Alimentos`, giro: "Alimentos y bebidas", tipoInstalacion: "PLANTA", rangoActivos: "1-50", nombre: "Tomás Prueba", correo: `tomas@${dominio}`, contrasena: "clave-segura-1", modo: "RECOMENDADA", aceptaDocumentos: true };
    const sinDocs = await pedir("POST", "/api/contratar", { "x-forwarded-for": "10.251.0.1" }, { ...contrato, aceptaDocumentos: false });
    const alta = await pedir("POST", "/api/contratar", { "x-forwarded-for": "10.251.0.1" }, contrato);
    const repetida = await pedir("POST", "/api/contratar", { "x-forwarded-for": "10.251.0.1" }, { ...contrato, empresa: "Otra" });
    const nuevaOrg = await prisma.organization.findFirst({ where: { name: contrato.empresa } });
    if (nuevaOrg) creadas.push(nuevaOrg.id);
    const sesionNueva = alta.cookie?.split(";")[0] ?? "";
    const puesta = await pedir("GET", "/puesta-en-marcha", { Cookie: sesionNueva });
    const prospectoAlta = await prisma.prospecto.findFirst({ where: { correo: contrato.correo } });
    revisar("23-24. sin aceptar documentos no avanza; al aceptar crea la empresa, su responsable y abre sesión; el correo repetido se rechaza",
      sinDocs.status === 422 && alta.status === 201 && alta.json.creada === true && !!nuevaOrg && repetida.status === 409 && !!sesionNueva, { sinDocs: sinDocs.status, alta: `${alta.status} ${JSON.stringify(alta.json).slice(0, 120)}`, repetida: repetida.status });
    revisar("20. queda en prueba de 30 días, con los documentos aceptados, el origen y el estado comercial registrados; sin cargos",
      !!nuevaOrg && nuevaOrg.status === "TRIAL" && Math.abs((nuevaOrg.trialEndsAt!.getTime() - Date.now()) / DIA - PRUEBA_DIAS) < 0.1 && !!nuevaOrg.terminosVersion && nuevaOrg.origenAlta === "REGISTRO"
      && prospectoAlta?.tipo === "CONTRATACION" && prospectoAlta.organizationId === nuevaOrg.id && (await emitirCargosDelPeriodo(periodo, { organizationId: nuevaOrg.id })).emitidos === 0);
    revisar("25. continúa a la puesta en marcha, con la configuración recomendada cargada", alta.json.destino === "/puesta-en-marcha" && puesta.status === 200 && (await prisma.warehouse.count({ where: { organizationId: nuevaOrg?.id } })) >= 1);
    if (nuevaOrg) {
      await prisma.organization.update({ where: { id: nuevaOrg.id }, data: { trialEndsAt: new Date(Date.now() - DIA) } });
      const vencida = await prisma.organization.findUniqueOrThrow({ where: { id: nuevaOrg.id } });
      const responsable = await prisma.user.findFirstOrThrow({ where: { organizationId: nuevaOrg.id } });
      const cR = await cookie(responsable);
      const escribe = await pedir("POST", "/api/assets", cR, { code: "X-1", name: "Equipo" });
      const soporteVencida = await pedir("POST", "/api/soporte", cR, { asunto: "Quiero contratar", descripcion: "Terminó mi prueba y quiero seguir." });
      revisar("   al vencer la prueba: solo lectura (no registra, 402), pero puede pedir soporte y no se cobra nada retroactivo", estadoSuscripcion(vencida).soloLectura && escribe.status === 402 && soporteVencida.status === 201, { escribe: escribe.status, soporte: soporteVencida.status });
    }
    // Con el alta cerrada —la operación de hoy— la misma pantalla solo registra la solicitud.
    const { POST: contratarCerrado } = await import("../app/api/contratar/route");
    const antesAbierta = process.env.ALLOW_PUBLIC_SIGNUP;
    process.env.ALLOW_PUBLIC_SIGNUP = "false";
    const cerrada = await contratarCerrado(new Request("http://x/api/contratar", { method: "POST", headers: { "x-forwarded-for": "10.252.0.1" }, body: JSON.stringify({ ...contrato, correo: `cerrada@${dominio}`, empresa: `${sello} Cerrada` }) }));
    process.env.ALLOW_PUBLIC_SIGNUP = antesAbierta;
    const cuerpoCerrada = await cerrada.json();
    revisar("   con el alta cerrada: «solicitud recibida», sin crear empresa ni simular pago", cerrada.status === 201 && cuerpoCerrada.creada === false && !(await prisma.organization.findFirst({ where: { name: `${sello} Cerrada` } })) && !!(await prisma.prospecto.findFirst({ where: { correo: `cerrada@${dominio}`, tipo: "CONTRATACION" } })));
    // 21. Cambio de plan
    const cambio = await pedir("PATCH", `/api/admin/organizations/${B.id}`, cOp, { plan: "ENTERPRISE" });
    const registro = await prisma.auditLog.findFirst({ where: { entityId: B.id, action: "CLIENT_UPDATED" }, orderBy: { createdAt: "desc" } });
    const demoPlan = await pedir("POST", "/api/plan-requests", c.direccion, { plan: "PROFESSIONAL" });
    const demoSuspende = await pedir("PATCH", `/api/admin/organizations/${demo.id}`, cOp, { status: "SUSPENDED" });
    revisar("21. el cambio de plan del operador surte efecto hoy y deja la fecha; la demo no cambia de plan ni se suspende",
      cambio.status === 200 && /efectivo el/.test(registro?.summary ?? "") && demoPlan.status === 403 && demoSuspende.status === 409, { cambio: cambio.status, demoPlan: demoPlan.status, demoSuspende: demoSuspende.status });

    // ═══════════════════════════════════════════ 26. Documentos
    console.log("\n26. Documentos legales");
    const docs = await Promise.all(["/legal", ...DOCUMENTOS.map((d) => `/legal/${d.clave}`)].map((r) => pedir("GET", r, {})));
    revisar("los 10 documentos y su índice se abren sin sesión, marcados como borrador para revisión profesional", DOCUMENTOS.length === 10 && docs.every((d) => d.status === 200 && d.texto.includes("Borrador para revisión profesional")), docs.map((d) => d.status));
    revisar("   el sitio enlaza todos los documentos en su pie", DOCUMENTOS.every((d) => sitio.texto.includes(`/legal/${d.clave}`)));

    // ═══════════════════════════════════════════ 27. Soporte
    console.log("\n27. Soporte dentro del producto");
    const pide = await pedir("POST", "/api/soporte", c.mecanico, { asunto: "No carga la foto", descripcion: "Al subir una foto desde el teléfono se queda en 0 %.", severidad: "MEDIA", pantalla: "OT-000041", datosTecnicos: { navegador: "prueba", pantalla: "390×844" } });
    const corta = await pedir("POST", "/api/soporte", c.mecanico, { asunto: "x", descripcion: "y" });
    const listaTec = await pedir("GET", "/api/soporte", c.mecanico);
    const listaSol = await pedir("GET", "/api/soporte", c.operador);
    const listaAdm = await pedir("GET", "/api/soporte", c.gerencia);
    const noOp = await pedir("GET", "/api/admin/soporte", c.direccion);
    const sopId = (pide.json.solicitud as { id: string; folio: string } | undefined)?.id ?? "";
    const responde = await pedir("PATCH", `/api/admin/soporte/${sopId}`, cOp, { estado: "RESUELTA", respuesta: "Se corrigió la carga en conexiones lentas." });
    const avisoTec = await prisma.notification.count({ where: { userId: du.mecanico.id, title: { contains: "SOP-000001" } } });
    const escala = await pedir("PATCH", `/api/soporte/${sopId}`, c.mecanico, { severidad: "ALTA" });
    const confirma = await pedir("PATCH", `/api/soporte/${sopId}`, c.mecanico, { confirmarResuelta: true });
    const yaCerrada = await pedir("PATCH", `/api/soporte/${sopId}`, c.mecanico, { nota: "otra cosa" });
    const ajeno = await pedir("PATCH", `/api/soporte/${sopId}`, c.operador, { nota: "no es mía" });
    const pantallas = await Promise.all(Object.values(c).map((k) => pedir("GET", "/soporte", k)));
    revisar("folio SOP-000001 con su tiempo objetivo; validación; cada quien ve lo suyo y la administración todo; solo el operador ve todas las empresas",
      pide.status === 201 && (pide.json.solicitud as { folio: string }).folio === "SOP-000001" && !!(pide.json.solicitud as { respuestaObjetivo: string }).respuestaObjetivo && corta.status === 422
      && (listaTec.json.solicitudes as unknown[]).length === 1 && (listaSol.json.solicitudes as unknown[]).length === 0 && (listaAdm.json.solicitudes as unknown[]).length >= 1 && noOp.status === 403,
      { pide: pide.status, corta: corta.status });
    revisar("el operador responde y avisa; el cliente escala y confirma; cerrada ya no acepta cambios; otra persona no la toca",
      responde.status === 200 && avisoTec === 1 && escala.status === 200 && confirma.status === 200 && (confirma.json.solicitud as { estado: string }).estado === "CERRADA" && yaCerrada.status === 409 && ajeno.status === 404,
      { responde: responde.status, avisoTec, escala: escala.status, confirma: confirma.status, yaCerrada: yaCerrada.status, ajeno: ajeno.status });
    revisar("   la pantalla Soporte abre para los 8 usuarios de la demo, sin correos ni teléfonos publicados", pantallas.every((p) => p.status === 200 && p.texto.includes("Nueva solicitud") && !/mailto:|tel:|wa\.me|soporte@/i.test(p.texto)));

    // ═══════════════════════════════════════════ 28. Aislamiento de la demo
    console.log("\n28. Aislamiento de la demo");
    const cruce = await Promise.all([
      pedir("GET", `/api/work-orders/${otB.id}`, c.direccion),
      pedir("GET", `/work-orders/${otB.id}`, c.direccion),
      pedir("GET", `/api/qr?codigo=${encodeURIComponent(`${base}/assets/${activoB.id}`)}`, c.direccion),
      pedir("GET", `/search?q=SECRETO-${sello}`, c.direccion),
      pedir("GET", "/api/users", c.direccion),
      pedir("GET", "/api/notifications", c.direccion),
      pedir("POST", "/api/integraciones/credenciales", c.direccion, { nombre: "Credencial" }),
      pedir("POST", "/api/integraciones/webhooks", c.direccion, { nombre: "Hook", url: "https://ejemplo.com/x", eventos: ["OT_CRITICA_CREADA"] }),
      pedir("GET", `/api/work-orders/${otS.id}`, cB),
    ]);
    const [otAjena, pagAjena, qrAjeno, buscaAjena, users, avisos, cred, hook, alReves] = cruce;
    revisar("la demo no abre registros, QR ni búsquedas de otra empresa; usuarios y avisos solo suyos",
      otAjena.status === 404 && !pagAjena.texto.includes("Orden de la otra empresa") && !(qrAjeno.json.destino) && !buscaAjena.texto.includes("Equipo de la otra empresa")
      && JSON.stringify(users.json).includes(dominio) && !JSON.stringify(users.json).includes(`${dominio}b`) && !JSON.stringify(avisos.json).includes(sello + " Normal"),
      { otAjena: otAjena.status, qr: qrAjeno.json });
    revisar("desde la demo no se crean credenciales ni webhooks; y la otra empresa no ve la demo", cred.status === 403 && hook.status === 403 && alReves.status === 404, { cred: cred.status, hook: hook.status, alReves: alReves.status });
    const auditoriaAjena = await prisma.auditLog.count({ where: { organizationId: demo.id, entityId: { in: [B.id, otB.id] } } });
    revisar("   la auditoría de la demo no contiene registros de otra empresa", auditoriaAjena === 0);

    // ═══════════════════════════════════════════ 34-35. Enlaces y consistencia
    console.log("\n34-35. Enlaces rotos, ortografía y consistencia");
    const publicas = ["/", "/contratar", "/legal", "/login"];
    const ligas = new Set<string>();
    for (const r of publicas) for (const m of (await pedir("GET", r, {})).texto.matchAll(/href="(\/[^"#?]*)/g)) ligas.add(m[1]);
    for (const m of guia.texto.matchAll(/href="(\/[^"#?]*)/g)) ligas.add(m[1]);
    const rotas: string[] = [];
    for (const l of ligas) {
      if (l.startsWith("/_next")) continue;
      const r = await pedir("GET", l, l.startsWith("/legal") || publicas.includes(l) || l === "/contratar" ? {} : c.direccion);
      if (r.status >= 400) rotas.push(`${l} ${r.status}`);
    }
    revisar(`ninguna liga rota en el sitio, la contratación, los documentos y la guía (${ligas.size} revisadas)`, rotas.length === 0, rotas);
    const faltanAcentos = /\b(gestion|creara|auditoria|Mineria|Energia|Logistica|Superviso \/ Recibio|informacion|operacion|demostracion|contratacion|Solicitud recibida\.)\b/;
    const archivos: string[] = [];
    const recorrer = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) recorrer(p); else if (/\.(tsx)$/.test(f)) archivos.push(p); } };
    ["app/contratar", "app/legal", "app/(app)/demo", "app/(app)/soporte", "components/publico", "components/demo", "app/(app)/clients/prospectos", "app/(app)/clients/soporte"].forEach(recorrer);
    const conFalta = archivos.filter((f) => readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).some((l) => faltanAcentos.test(l.replace(/"[^"]*"/g, '""'))));
    const marcaVieja = [...archivos, "app/layout.tsx", "app/manifest.ts", "app/login/login-form.tsx", "components/shell/sidebar.tsx"].filter((f) => /MainTrack CMMS/.test(readFileSync(f, "utf8")));
    revisar("sin acentos faltantes en los textos nuevos y la marca es «MainTrack» en título, acceso, menú e impresos", conFalta.length === 0 && marcaVieja.length === 0 && /<title>MainTrack/.test(sitio.texto), { conFalta, marcaVieja });
  } finally {
    await prisma.prospecto.deleteMany({ where: { correo: { endsWith: `@${dominio}` } } }).catch(() => undefined);
    await prisma.limiteUso.deleteMany({ where: { clave: { startsWith: "prospectos:" } } }).catch(() => undefined);
    // Los avisos que recibió el operador de la plataforma por las solicitudes de la prueba.
    await prisma.notification.deleteMany({ where: { title: { contains: sello } } }).catch(() => undefined);
    const { borrarDemo } = await import("../lib/demo-comercial");
    for (const id of [...creadas].reverse()) {
      const o = await prisma.organization.findUnique({ where: { id }, select: { esDemo: true } });
      if (o?.esDemo) await borrarDemo(id).catch((e) => console.error("no se borró la demo", id, e));
      else if (o) {
        // Las empresas normales de la prueba se borran con el mismo recorrido que la demo.
        await prisma.organization.update({ where: { id }, data: { esDemo: true } });
        await borrarDemo(id).catch((e) => console.error("no se borró", id, e));
      }
    }
    if (servidor?.pid) { try { process.kill(-servidor.pid, "SIGTERM"); } catch { /* ya terminó */ } }
  }

  console.log("\nAislamiento de la prueba");
  revisar("las demás empresas quedaron exactamente como estaban", antes === await foto());
  console.log(fallos ? `\n${fallos} revisión(es) fallaron` : "\nTodo bien");
  await prisma.$disconnect();
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
