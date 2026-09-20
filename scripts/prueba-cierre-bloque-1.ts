/**
 * Cierre del Bloque 1: hallazgos de la validación en producción.
 *
 * Llama las mismas funciones que usan las pantallas y los procesos. Crea dos
 * empresas de prueba y las borra al final.
 *
 *   npx tsx scripts/prueba-cierre-bloque-1.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/db";
import { evaluarPunto, textoDeCruce, T_SIGNIFICATIVA } from "../lib/predictive";
import { aplicarSaneamiento, planearSaneamiento, PROCESO_SANEAMIENTO } from "../lib/saneamiento-predictivo";
import { revisarCalidad } from "../lib/calidad-datos";
import { periodoIndicadores, describirPeriodo } from "../lib/periodos";
import { costoDeParar, ventanas } from "../lib/costo-de-parar";
import { calcularIndicadores } from "../lib/indicadores";
import { clasificarFalla, filtroDeFalla, solicitudesDeFalla } from "../lib/fallas";
import { anularLectura, planearRecalculo, recalcularMedidor } from "../lib/medidores";
import { ultimoDiagnostico } from "../lib/ia/diagnostico";

let fallas = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${typeof detalle === "string" ? detalle : JSON.stringify(detalle)}` : ""}`);
}
const DIA = 86_400_000;
const ZONA = "America/Monterrey";

/** Generador determinista (sin Math.random): las pruebas dan lo mismo siempre. */
function lcg(semilla: number) {
  let x = semilla >>> 0;
  return () => ((x = (1664525 * x + 1013904223) >>> 0) / 2 ** 32) - 0.5;
}

// La serie REAL del punto «Temperatura de descarga» de CMP-301 (producción, 30 lecturas).
const SERIE_CMP301: Array<[string, number]> = [["2026-08-29",89.2],["2026-08-26",87.72],["2026-08-23",89.06],["2026-08-20",89.18],["2026-08-17",88.3],["2026-08-14",88.17],["2026-08-11",87.89],["2026-08-08",85.48],["2026-08-05",86.56],["2026-08-02",86.21],["2026-07-30",86.64],["2026-07-27",84.73],["2026-07-24",85.7],["2026-07-21",85.12],["2026-07-18",82.98],["2026-07-15",84.04],["2026-07-12",81.52],["2026-07-09",83.54],["2026-07-06",81.18],["2026-07-03",82.78],["2026-06-30",83.1],["2026-06-27",79.94],["2026-06-24",79.37],["2026-06-21",81.41],["2026-06-18",79.42],["2026-06-15",78.64],["2026-06-12",79.89],["2026-06-09",79.94],["2026-06-06",77.66],["2026-06-03",79.37]];

function modoHidratacion() {
  // Hijo: imprime lo que dibujarian los componentes con fechas, para compararlo
  // entre el proceso en UTC (servidor) y en America/Monterrey (navegador).
  // Se carga lib/utils y lib/vencimiento de forma perezosa: el TZ ya esta fijado.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const u = require("../lib/utils") as typeof import("../lib/utils");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const v = require("../lib/vencimiento") as typeof import("../lib/vencimiento");
  const ahora = new Date("2026-09-17T04:30:00Z"); // 11:30 pm del 16 en Monterrey: el caso que se recorre
  const momentos = ["2026-09-17T04:30:00Z", "2026-09-16T23:59:00Z", "2026-09-16T00:00:00.000Z", "2026-12-31T23:10:00Z"].map((s) => new Date(s));
  const salida = momentos.flatMap((m) => [
    u.formatDate(m, ZONA), u.formatDateTime(m, ZONA), u.formatDia(m, { zona: ZONA }),
    u.claveDia(m, ZONA), String(u.diaDeCalendario(m, ZONA).getDate()),
    v.estadoDeVencimiento({ status: "OPEN", dueDate: m }, { zona: ZONA, ahora }).texto,
  ]);
  console.log(JSON.stringify(salida));
}

async function main() {
  if (process.argv.includes("--hidratacion")) return modoHidratacion();

  // ───────────────────────────────────────── 1. Predictivo ───
  console.log("\n1. Predictivo: una sola regresión para estado, tendencia, pendiente, confianza y fecha");
  const ahora = new Date("2026-09-17T07:00:00Z");
  const temp = { warningThreshold: 88, criticalThreshold: 98, direction: "ABOVE", unit: "°C" };
  const cmp = evaluarPunto(SERIE_CMP301.map(([d, v]) => ({ value: v, readingAt: new Date(`${d}T05:48:36.598Z`) })), temp, ahora, ZONA);
  revisar("CMP-301: pendiente +0.131 °C/día significativa → «Empeorando», no «Estable»", cmp.tendencia === "EMPEORA" && Math.abs(cmp.pendientePorDia - 0.1312) < 0.001 && (cmp.tPendiente ?? 0) >= T_SIGNIFICATIVA, { t: cmp.tendencia, p: cmp.pendientePorDia, tP: cmp.tPendiente });
  revisar("CMP-301: con esa pendiente sí hay fecha de cruce crítico", cmp.cruceCritico.fecha !== null && cmp.cruceCritico.razon === null, cmp.cruceCritico.texto);
  const esperada = new Date(new Date("2026-08-29T05:48:36.598Z").getTime() + ((98 - 89.2) / cmp.pendientePorDia) * DIA);
  revisar("la fecha sale EXACTAMENTE de la pendiente mostrada: (98 − 89.2) ÷ pendiente desde la última lectura",
    Math.abs((cmp.cruceCritico.fecha?.getTime() ?? 0) - esperada.getTime()) < 1000, cmp.cruceCritico.fecha?.toISOString());
  revisar("CMP-301: estado advertencia, confianza alta sin porcentaje", cmp.estado === "ADVERTENCIA" && cmp.confianza === "ALTA" && !/%/.test(cmp.etiquetaConfianza));

  const dias = (n: number) => Array.from({ length: n }, (_, i) => new Date(ahora.getTime() - (n - 1 - i) * DIA));
  const serie = (f: (i: number) => number, n = 30) => dias(n).map((readingAt, i) => ({ value: f(i), readingAt }));
  const ruido = lcg(7);
  const sube = evaluarPunto(serie((i) => 50 + 0.5 * i + ruido() * 0.4), { warningThreshold: 70, criticalThreshold: 80, direction: "ABOVE" }, ahora, ZONA);
  revisar("pendiente positiva significativa → cruce futuro con fecha", sube.tendencia === "EMPEORA" && !!sube.cruceCritico.fecha && sube.cruceCritico.fecha > ahora, sube.cruceCritico.texto);
  const r2 = lcg(11);
  const estable = evaluarPunto(serie(() => 60 + r2() * 2), { warningThreshold: 70, criticalThreshold: 80, direction: "ABOVE" }, ahora, ZONA);
  revisar("tendencia estable real (ruido sin pendiente) → «Estable» y razón «no se distingue del ruido»",
    estable.tendencia === "ESTABLE" && estable.cruceCritico.razon === "PENDIENTE_NO_SIGNIFICATIVA" && /ruido/.test(estable.cruceCritico.texto), { t: estable.tPendiente, txt: estable.cruceCritico.texto });
  const r3 = lcg(13);
  const baja = evaluarPunto(serie((i) => 60 - 0.4 * i + r3() * 0.5), { warningThreshold: 70, criticalThreshold: 80, direction: "ABOVE" }, ahora, ZONA);
  revisar("tendencia negativa (se aleja del umbral) → «Mejorando» y razón «dirección contraria»", baja.tendencia === "MEJORA" && baja.cruceCritico.razon === "DIRECCION_CONTRARIA", baja.cruceCritico.texto);

  // Confianza insuficiente: pendiente significativa (t ≥ 2) pero R² < 0.5.
  let debil: ReturnType<typeof evaluarPunto> | null = null;
  for (let amp = 1; amp < 60 && !debil; amp += 0.5) {
    const r = lcg(3);
    const e = evaluarPunto(serie((i) => 60 + 0.15 * i + r() * amp), { warningThreshold: 90, criticalThreshold: 95, direction: "ABOVE" }, ahora, ZONA);
    if (e.tendencia === "EMPEORA" && (e.r2 ?? 1) < 0.5) debil = e;
  }
  revisar("pendiente significativa con ajuste pobre → sin fecha y razón «confianza insuficiente»",
    !!debil && debil.confianza === "BAJA" && debil.cruceCritico.razon === "CONFIANZA_INSUFICIENTE" && debil.cruceCritico.fecha === null, debil && { r2: debil.r2, t: debil.tPendiente, txt: debil.cruceCritico.texto });
  const arriba = evaluarPunto(serie(() => 99), temp, ahora, ZONA);
  revisar("umbral ya superado → «Crítico» y «Umbral ya superado»", arriba.estado === "CRITICO" && arriba.cruceCritico.razon === "UMBRAL_SUPERADO");
  const vencida = textoDeCruce(new Date(ahora.getTime() - 10 * DIA), ahora, false, ZONA);
  revisar("fecha guardada que ya pasó → «Proyección vencida», nunca como futura", vencida.razon === "PROYECCION_VENCIDA" && vencida.fecha === null, vencida.texto);

  // Invariante: nunca pendiente significativa hacia el umbral con confianza suficiente y «sin cruce» sin razón válida.
  let contradicciones = 0;
  for (let semilla = 1; semilla <= 200; semilla++) {
    const r = lcg(semilla);
    const pend = r() * 1.2;
    const e = evaluarPunto(serie((i) => 40 + pend * i + r() * 3), { warningThreshold: 70, criticalThreshold: 90, direction: "ABOVE" }, ahora, ZONA);
    const valida = ["UMBRAL_SUPERADO", "FUERA_DE_HORIZONTE", "CONFIANZA_INSUFICIENTE"].includes(e.cruceCritico.razon ?? "");
    if (e.tendencia === "EMPEORA" && e.pendientePorDia > 0 && !e.cruceCritico.fecha && !valida) contradicciones++;
    if (e.tendencia === "ESTABLE" && (e.tPendiente ?? 0) >= T_SIGNIFICATIVA) contradicciones++;
  }
  revisar("200 series: ninguna contradicción entre pendiente, tendencia y fecha", contradicciones === 0, contradicciones);

  const sufijo = Date.now();
  const orgA = await prisma.organization.create({ data: { name: "Prueba cierre A", slug: `pca-${sufijo}`, timezone: ZONA } });
  const orgB = await prisma.organization.create({ data: { name: "Prueba cierre B", slug: `pcb-${sufijo}`, timezone: ZONA } });
  try {
    const site = await prisma.site.create({ data: { organizationId: orgA.id, code: "P", name: "Planta" } });
    const loc1 = await prisma.location.create({ data: { organizationId: orgA.id, siteId: site.id, code: "L1", name: "Línea 1" } });
    const loc2 = await prisma.location.create({ data: { organizationId: orgA.id, siteId: site.id, code: "L2", name: "Línea 2" } });
    const cnc = await prisma.asset.create({ data: { organizationId: orgA.id, siteId: site.id, locationId: loc1.id, code: "CNC-201", name: "Centro de maquinado", criticality: "A" } });
    const bomba = await prisma.asset.create({ data: { organizationId: orgA.id, siteId: site.id, locationId: loc2.id, code: "BOM-1", name: "Bomba" } });
    const user = await prisma.user.create({ data: { organizationId: orgA.id, email: `c-${sufijo}@x.mx`, name: "C", passwordHash: "x", role: "ADMIN" } });

    // ─────────────────────────────── 2. Saneamiento de fechas históricas ───
    console.log("\n2. Saneamiento de fechas predictivas anteriores a su detección");
    const ahoraReal = new Date();
    const sensor = await prisma.sensor.create({ data: { organizationId: orgA.id, assetId: cnc.id, name: "Vibración husillo", sensorType: "VIBRATION", unit: "mm/s", warningThreshold: 4.5, criticalThreshold: 7.1 } });
    await prisma.sensorReading.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({ organizationId: orgA.id, sensorId: sensor.id, value: 10 + i * 0.1, status: "CRITICAL", readingAt: new Date(ahoraReal.getTime() - (8 - i) * DIA) })),
    });
    const detectada = new Date(ahoraReal.getTime() - 20 * DIA);
    const invalida = await prisma.predictiveAlert.create({ data: { organizationId: orgA.id, sensorId: sensor.id, assetId: cnc.id, severity: "CRITICAL", title: "Vibración husillo — CNC", message: "x", status: "OPEN", createdAt: detectada, projectedFailureAt: new Date(detectada.getTime() - 38 * DIA) } });
    const cerrada = await prisma.predictiveAlert.create({ data: { organizationId: orgA.id, assetId: cnc.id, title: "Cerrada", message: "x", status: "RESOLVED", createdAt: detectada, projectedFailureAt: new Date(detectada.getTime() - 1000) } });
    const valida = await prisma.predictiveAlert.create({ data: { organizationId: orgA.id, assetId: bomba.id, title: "Válida", message: "x", status: "ACKNOWLEDGED", createdAt: detectada, projectedFailureAt: new Date(detectada.getTime() + 60 * DIA) } });
    const lecturasAntes = await prisma.sensorReading.count({ where: { organizationId: orgA.id } });

    const plan = await planearSaneamiento(orgA.id, ahoraReal);
    revisar("el ensayo encuentra solo las 2 fechas anteriores a su detección (no la válida)",
      plan.length === 2 && plan.some((c) => c.alertaId === invalida.id) && plan.some((c) => c.alertaId === cerrada.id) && !plan.some((c) => c.alertaId === valida.id), plan.map((c) => c.titulo));
    revisar("el ensayo no escribe", (await prisma.predictiveAlert.findUniqueOrThrow({ where: { id: invalida.id } })).projectedFailureAt !== null);
    const deCnc = plan.find((c) => c.alertaId === invalida.id)!;
    revisar("umbral superado → se limpia (no se inventa una fecha futura)", deCnc.despues === null && /umbral ya está superado/.test(deCnc.motivo), deCnc.motivo);
    revisar("otra empresa no ve estas alertas", (await planearSaneamiento(orgB.id, ahoraReal)).length === 0);

    const aplicados = await aplicarSaneamiento(orgA.id, plan, ahoraReal);
    const tras = await prisma.predictiveAlert.findUniqueOrThrow({ where: { id: invalida.id } });
    const bitacora = await prisma.auditLog.findFirst({ where: { organizationId: orgA.id, entityId: invalida.id, action: "FECHA_PREDICTIVA_SANEADA" } });
    const cambios = JSON.parse(bitacora?.changes ?? "{}");
    revisar("aplicado: fecha limpia y la alerta se conserva abierta", aplicados === 2 && tras.projectedFailureAt === null && tras.status === "OPEN");
    revisar("bitácora con valor anterior, corregido, motivo, fecha y proceso",
      cambios.valorAnterior && cambios.valorCorregido === null && cambios.motivo && cambios.corregidoEl && cambios.proceso === PROCESO_SANEAMIENTO, cambios);
    revisar("no borra lecturas ni alertas; no toca la válida",
      (await prisma.sensorReading.count({ where: { organizationId: orgA.id } })) === lecturasAntes &&
      (await prisma.predictiveAlert.count({ where: { organizationId: orgA.id } })) === 3 &&
      (await prisma.predictiveAlert.findUniqueOrThrow({ where: { id: valida.id } })).projectedFailureAt?.getTime() === valida.projectedFailureAt?.getTime());
    revisar("idempotente: una segunda corrida no encuentra nada", (await planearSaneamiento(orgA.id, ahoraReal)).length === 0);
    const hoyCnc = evaluarPunto(await prisma.sensorReading.findMany({ where: { sensorId: sensor.id }, select: { value: true, readingAt: true } }), sensor, ahoraReal, ZONA);
    revisar("CNC-201 sigue crítico con «Umbral ya superado»", hoyCnc.estado === "CRITICO" && hoyCnc.cruceCritico.texto === "Umbral ya superado");
    const calidad = await revisarCalidad(orgA.id, ahoraReal);
    revisar("calidad de datos ya no reporta la fecha saneada", !calidad.find((r) => r.clave === "alertas-fechas-incoherentes")!.hallazgos.some((h) => h.id === invalida.id));

    // ─────────────── 3-4. Periodos y «Dónde para la planta» vs indicadores ───
    console.log("\n4. Mismo periodo y misma cifra en Reportes y Dónde para la planta");
    const p90 = periodoIndicadores(90, ZONA, ahoraReal);
    const v90 = ventanas("TRIMESTRE", ahoraReal, ZONA);
    revisar("90 días: mismas fronteras en indicadores y Dónde para la planta", v90.actual.desde.getTime() === p90.desde.getTime() && v90.actual.hasta.getTime() === p90.hasta.getTime());
    revisar("el último día es hoy en Monterrey, sin sumar un día por UTC",
      describirPeriodo({ desde: v90.actual.desde, hasta: v90.actual.hasta, zonaHoraria: ZONA }) === describirPeriodo(p90) &&
      new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: ZONA }).format(new Date(p90.hasta.getTime() - 1)) === new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: ZONA }).format(ahoraReal));
    // Dos áreas con 20 min planeados cada una: por área 0.3 + 0.3 = 0.6 h; en total 40 min = 0.7 h.
    await prisma.downtimeEvent.createMany({ data: [
      { organizationId: orgA.id, assetId: cnc.id, startedAt: new Date(ahoraReal.getTime() - 2 * DIA), minutes: 20, planned: true },
      { organizationId: orgA.id, assetId: bomba.id, startedAt: new Date(ahoraReal.getTime() - 3 * DIA), minutes: 20, planned: true },
    ] });
    const dpp = await costoDeParar(orgA.id, v90.actual);
    const ind = await calcularIndicadores(orgA.id, p90, { ahora: ahoraReal });
    revisar("«mantenimiento planeado» = «Paro planeado» (se redondea una vez, no por área)",
      dpp.horasPlaneadas === ind.indicadores.paroPlaneado.valor && dpp.horasPlaneadas === 0.7, { dondePara: dpp.horasPlaneadas, indicador: ind.indicadores.paroPlaneado.valor });

    // ─────────────────────────────────────── 5. Clasificación de falla ───
    console.log("\n5. Clasificación centralizada de falla");
    const sinSolicitudes = new Set<string>();
    const orden = (maintenanceType: string, extra: Partial<Parameters<typeof clasificarFalla>[0]> = {}) =>
      ({ status: "COMPLETED", maintenanceType, failureCodeId: null, tasks: [], ...extra });
    revisar("preventivo sin falla registrada → no es falla", !clasificarFalla(orden("PREVENTIVE"), sinSolicitudes).esFalla);
    revisar("preventivo con una actividad marcada correctiva pero sin código ni solicitud → no es falla",
      !clasificarFalla(orden("PREVENTIVE", { tasks: [{ title: "Ajuste", maintenanceType: "CORRECTIVE", failureCodeId: null, origenRequestId: null }] }), sinSolicitudes).esFalla);
    revisar("correctivo → falla «Orden correctiva»", clasificarFalla(orden("CORRECTIVE"), sinSolicitudes).razon === "Orden correctiva");
    revisar("seguridad sin condición de falla → no es falla", !clasificarFalla(orden("SAFETY"), sinSolicitudes).esFalla);
    revisar("seguridad con código de falla → falla", clasificarFalla(orden("SAFETY", { failureCodeId: "x" }), sinSolicitudes).esFalla);
    revisar("predictivo → no es falla", !clasificarFalla(orden("PREDICTIVE"), sinSolicitudes).esFalla);
    revisar("falla detectada durante un preventivo (actividad correctiva con código) → falla con razón",
      /Falla registrada en la actividad «Cuchillas»/.test(clasificarFalla(orden("PREVENTIVE", { tasks: [{ title: "Cuchillas", maintenanceType: "CORRECTIVE", failureCodeId: "fc", origenRequestId: null }] }), sinSolicitudes).razon ?? ""));
    revisar("código puesto por error en una actividad preventiva → no es falla",
      !clasificarFalla(orden("PREVENTIVE", { tasks: [{ title: "Aceite", maintenanceType: "PREVENTIVE", failureCodeId: "fc", origenRequestId: null }] }), sinSolicitudes).esFalla);
    revisar("actividad de una solicitud clasificada como falla → falla con razón",
      /solicitud clasificada como falla/.test(clasificarFalla(orden("PREVENTIVE", { tasks: [{ title: "Cuchillas", failureCodeId: null, origenRequestId: "s1" }] }), new Set(["s1"])).razon ?? ""));
    revisar("correctivo cancelado → no es falla", !clasificarFalla(orden("CORRECTIVE", { status: "CANCELLED" }), sinSolicitudes).esFalla);

    const codigo = await prisma.failureCode.create({ data: { organizationId: orgA.id, code: "DES", description: "Desgaste" } });
    const solFalla = await prisma.workRequest.create({ data: { organizationId: orgA.id, number: "SS-1", title: "Cuchillas desgastadas", tipo: "FALLA", status: "CONVERTED" } });
    const hace = (d: number) => new Date(ahoraReal.getTime() - d * DIA);
    const ot = (number: string, maintenanceType: string, tasks: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) =>
      prisma.workOrder.create({ data: { organizationId: orgA.id, number, title: number, assetId: bomba.id, maintenanceType, status: "COMPLETED", createdAt: hace(5), completedAt: hace(4), actualHours: 2, tasks: { create: tasks.map((t, i) => ({ position: i, title: `A${i}`, ...t })) }, ...extra } });
    const prev = await ot("PREV", "PREVENTIVE", [{ maintenanceType: "CORRECTIVE" }]);
    const corr = await ot("CORR", "CORRECTIVE");
    const seg = await ot("SEG", "SAFETY");
    const pred = await ot("PRED", "PREDICTIVE");
    const prevCodigo = await ot("PREV-COD", "PREVENTIVE", [{ maintenanceType: "CORRECTIVE", failureCodeId: codigo.id }]);
    const prevCodigoError = await ot("PREV-ERR", "PREVENTIVE", [{ maintenanceType: "PREVENTIVE", failureCodeId: codigo.id }]);
    const prevSolicitud = await ot("PREV-SOL", "PREVENTIVE", [{ origen: "SOLICITUD", origenRequestId: solFalla.id }]);

    const filtro = await filtroDeFalla(orgA.id);
    const enBase = new Set((await prisma.workOrder.findMany({ where: { ...filtro, organizationId: orgA.id }, select: { id: true } })).map((o) => o.id));
    const deFalla = await solicitudesDeFalla(orgA.id);
    const todas = await prisma.workOrder.findMany({ where: { organizationId: orgA.id }, select: { id: true, status: true, maintenanceType: true, failureCodeId: true, tasks: { select: { title: true, maintenanceType: true, failureCodeId: true, origenRequestId: true } } } });
    revisar("el filtro de base y la función clasifican igual cada orden", todas.every((o) => enBase.has(o.id) === clasificarFalla(o, deFalla).esFalla));
    revisar("cuentan: correctivo, preventivo con código, preventivo con solicitud de falla",
      [corr, prevCodigo, prevSolicitud].every((o) => enBase.has(o.id)) && ![prev, seg, pred, prevCodigoError].some((o) => enBase.has(o.id)));
    const p30 = periodoIndicadores(30, ZONA, ahoraReal);
    const i30 = await calcularIndicadores(orgA.id, p30, { ahora: ahoraReal });
    const idsMtbf = new Set(i30.indicadores.mtbf.detalle.map((r) => r.id));
    revisar("MTBF, MTTR y la base usan la misma regla", [...enBase].every((id) => idsMtbf.has(id)) && idsMtbf.size === enBase.size &&
      i30.indicadores.mttr.detalle.every((r) => enBase.has(r.id)));
    revisar("cada registro del MTBF y MTTR trae su razón visible",
      [...i30.indicadores.mtbf.detalle, ...i30.indicadores.mttr.detalle].every((r) => !!r.razon), i30.indicadores.mtbf.detalle.map((r) => `${r.folio}: ${r.razon}`));
    const reglas = await revisarCalidad(orgA.id, ahoraReal);
    revisar("calidad de datos usa la misma regla (universo de «fallas sin diagnóstico»)", reglas.find((r) => r.clave === "fallas-sin-diagnostico")!.total === enBase.size);

    // ─────────────────────────── 6. Proyección suspendida por medidor inválido ───
    console.log("\n6. Proyección suspendida por lectura inválida y reanudación");
    const medidor = await prisma.meter.create({ data: { organizationId: orgA.id, assetId: cnc.id, name: "Horómetro", unit: "h", tipo: "HOROMETRO" } });
    const planUso = await prisma.maintenancePlan.create({ data: { organizationId: orgA.id, name: "Servicio 2,000 h", triggerType: "METER", intervalMeter: 2000 } });
    const asig = await prisma.planAsset.create({ data: { organizationId: orgA.id, planId: planUso.id, assetId: cnc.id, meterId: medidor.id, nextDueMeter: 20000 } });
    await prisma.meterReading.createMany({ data: [
      { organizationId: orgA.id, meterId: medidor.id, value: 18000, readingAt: hace(30) },
      { organizationId: orgA.id, meterId: medidor.id, value: 18420, readingAt: hace(10) },
      { organizationId: orgA.id, meterId: medidor.id, value: 20500, readingAt: hace(6) },
    ] });
    const imposible = await prisma.meterReading.findFirstOrThrow({ where: { meterId: medidor.id, value: 20500 } });
    await recalcularMedidor(orgA.id, medidor.id);
    let m = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } });
    let a = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig.id } });
    revisar("lectura imposible → proyección suspendida con motivo", m.proyeccionSuspendida && /físicamente imposible/.test(m.motivoSuspension ?? ""), m.motivoSuspension);
    revisar("sin fecha estimada del plan mientras esté suspendida", a.nextDueDate === null);
    const plane = await planearRecalculo(prisma, orgA.id, medidor.id, new Date(), ZONA);
    revisar("el recálculo reporta el plan como SUSPENDIDA y la lectura como inválida", plane.planes[0].estadoDespues === "SUSPENDIDA" && plane.lecturasSospechosas.some((l) => l.invalida));
    revisar("la lectura NO se corrige sola", (await prisma.meterReading.findUniqueOrThrow({ where: { id: imposible.id } })).estado === "VALIDA");
    await anularLectura({ organizationId: orgA.id, readingId: imposible.id, userId: user.id, motivo: "Físicamente imposible" });
    m = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } });
    a = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig.id } });
    revisar("anulada la lectura: la proyección se reanuda sola con fecha", !m.proyeccionSuspendida && m.motivoSuspension === null && a.nextDueDate !== null && m.currentValue === 18420, { fecha: a.nextDueDate });

    // ─────────────────────────────────────── 7. Diagnóstico histórico ───
    console.log("\n7. Diagnóstico como fotografía");
    await prisma.aiReport.create({ data: { organizationId: orgA.id, desde: hace(30), hasta: hace(1), resumen: "viejo", contenido: JSON.stringify({}), modelo: "x", createdAt: hace(1) } });
    const diag = await ultimoDiagnostico(orgA.id);
    revisar("hay datos posteriores al diagnóstico → se avisa que los indicadores pueden haber cambiado", diag?.datosPosteriores === true);
    revisar("el diagnóstico guardado no se recalcula", diag?.resumen === "viejo");
    revisar("otra empresa no ve ese diagnóstico", (await ultimoDiagnostico(orgB.id)) === null);
    // Diagnostico generado despues de todo: sin datos posteriores no se avisa.
    const lectura = await prisma.meterReading.findFirstOrThrow({ where: { meterId: medidor.id, value: 18420 } });
    const fotoNueva = await prisma.aiReport.create({ data: { organizationId: orgA.id, desde: hace(30), hasta: hace(0), resumen: "nuevo", contenido: JSON.stringify({}), modelo: "x", createdAt: new Date(Date.now() + 60_000) } });
    const alDia = await ultimoDiagnostico(orgA.id);
    revisar("sin nada posterior → no se avisa, y se conserva el anterior", alDia?.datosPosteriores === false && alDia?.diagnosticosAnteriores === 1, alDia);
    // Una lectura vieja anulada despues del diagnostico si cambia las cifras.
    await anularLectura({ organizationId: orgA.id, readingId: lectura.id, userId: user.id, motivo: "Prueba", ahora: new Date(Date.now() + 120_000) });
    const trasCorregir = await ultimoDiagnostico(orgA.id);
    revisar("una lectura anterior anulada después del diagnóstico → se avisa", trasCorregir?.datosPosteriores === true && trasCorregir.id === fotoNueva.id);
  } finally {
    await prisma.organization.delete({ where: { id: orgA.id } });
    await prisma.organization.delete({ where: { id: orgB.id } });
  }

  // ───────────────────────────────────────────── 3. Hidratación ───
  console.log("\n3. Renderizado sin diferencias de hidratación");
  const correr = (tz: string) => execFileSync("npx", ["tsx", __filename, "--hidratacion"], { env: { ...process.env, TZ: tz }, encoding: "utf8" }).trim().split("\n").at(-1)!;
  const servidor = correr("UTC");
  const navegador = correr("America/Monterrey");
  revisar("fechas y vencimientos idénticos con el servidor en UTC y el navegador en Monterrey (11:30 pm)", servidor === navegador, servidor === navegador ? undefined : { servidor, navegador });

  // Revisión estática: un componente del navegador que formatea sin zona vuelve a romper la hidratación.
  const raiz = process.cwd();
  const archivos: string[] = [];
  const recorrer = (d: string) => {
    for (const f of readdirSync(d)) {
      const r = join(d, f);
      if (statSync(r).isDirectory()) recorrer(r);
      else if (f.endsWith(".tsx")) archivos.push(r);
    }
  };
  recorrer(join(raiz, "app"));
  recorrer(join(raiz, "components"));
  const sinZona: string[] = [];
  for (const f of archivos) {
    const src = readFileSync(f, "utf8");
    if (!src.startsWith('"use client"')) continue;
    const lineas = src.split("\n");
    lineas.forEach((linea, i) => {
      // La instruccion puede seguir en las dos lineas siguientes (opciones de Intl).
      const l = [linea, lineas[i + 1] ?? "", lineas[i + 2] ?? ""].map((x) => x.trim()).join(" ");
      if (linea.trim().startsWith("//") || linea.trim().startsWith("*")) return;
      const malo =
        (/\bformatDate(Time)?\(/.test(linea) && !/zona/.test(l) && !/function formatDate/.test(l)) ||
        (/\bformatDia\(/.test(linea) && !/zona/.test(l)) ||
        (/\b(claveDia|diaDeCalendario)\(/.test(linea) && !/zona|T12:00|new Date\(\)\.toISOString/.test(l)) ||
        (/toLocale(Date|Time)?String\(/.test(linea) && /es-MX/.test(l) && !/timeZone|Number\(|diaDeCalendario\([^)]*zona\)/.test(l)) ||
        /\bdueLabel\(/.test(linea);
      if (malo) sinZona.push(`${f.replace(raiz + "/", "")}:${i + 1}: ${l.slice(0, 100)}`);
    });
  }
  revisar("ningún componente del navegador formatea fechas sin la zona de la empresa", sinZona.length === 0, sinZona);

  console.log(fallas ? `\n${fallas} fallas\n` : "\nTodo bien\n");
  await prisma.$disconnect();
  process.exit(fallas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
