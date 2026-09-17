/**
 * Bloque 1 · Integridad de datos e indicadores.
 *
 * Llama las MISMAS funciones que usan las rutas y las pantallas
 * (`lib/indicadores`, `lib/medidores`, `lib/predictive`, `lib/calidad-datos`,
 * `lib/workorders`), sobre dos empresas de prueba que se crean y se borran.
 *
 *   npx tsx scripts/prueba-integridad-datos.ts
 */
import { prisma } from "../lib/db";
import { calcularIndicadores, type Indicadores } from "../lib/indicadores";
import { periodoIndicadores, periodoAnterior, caeEn, claveDiaEnZona, medianocheEnZona } from "../lib/periodos";
import { estadoDeVencimiento } from "../lib/vencimiento";
import { ventanas } from "../lib/costo-de-parar";
import { ejecutarHerramienta } from "../lib/ia/herramientas";
import { transitionWorkOrder } from "../lib/workorders";
import {
  anularLectura, corregirLectura, registrarLectura, validarLectura, LecturaRechazada,
} from "../lib/medidores";
import { evaluarPunto, ingestSensorReading, textoDeCruce } from "../lib/predictive";
import { revisarCalidad, validarFechasDeActivo } from "../lib/calidad-datos";
import { saludDeDatos } from "../lib/salud-datos";
import { planearRecalculo, recalcularMedidor } from "../lib/medidores";
import { validarNormalizacion } from "../lib/predictive";
import { diariasSinConfirmar, esquemaTarea } from "../lib/plan-tasks";
import { reemplazarTareasConRastro as reemplazarTareas } from "../lib/tareas-con-rastro";
import { formatDate, formatDateTime } from "../lib/utils";

let fallas = 0;
function revisar(afirmacion: string, ok: boolean, detalle?: unknown) {
  if (!ok) fallas++;
  console.log(`  ${ok ? "ok   " : "FALLA"} ${afirmacion}${detalle !== undefined ? `  → ${typeof detalle === "string" ? detalle : JSON.stringify(detalle)}` : ""}`);
}
const cerca = (a: number | null, b: number, tol = 0.01) => a !== null && Math.abs(a - b) <= tol;

const DIA = 86_400_000;
const ZONA = "America/Monterrey";

async function lanza(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof LecturaRechazada ? e.validacion.codigo : e instanceof Error ? e.message : String(e);
  }
}

/** La suma del detalle debe dar la cifra (o su numerador) exactamente. */
function detalleCuadra(k: Indicadores) {
  const i = k.indicadores;
  const suma = (x: { detalle: Array<{ aporte: number }> }) => x.detalle.reduce((s, r) => s + r.aporte, 0);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    paroTotal: r1(suma(i.paroTotal)) === i.paroTotal.valor,
    paroNoPlaneado: r1(suma(i.paroNoPlaneado)) === i.paroNoPlaneado.valor,
    paroPlaneado: r1(suma(i.paroPlaneado)) === i.paroPlaneado.valor,
    costo: Math.round(suma(i.costoMantenimiento)) === i.costoMantenimiento.valor,
    mttr: i.mttr.valor === null ? i.mttr.detalle.length === 0 : r1(suma(i.mttr) / (i.mttr.denominador as number)) === i.mttr.valor,
    mtbf: i.mtbf.detalle.length === i.mtbf.denominador,
    cumplimiento: i.cumplimientoPreventivo.valor === null
      || cerca((i.cumplimientoPreventivo.detalle.filter((r) => r.aFavor).length / (i.cumplimientoPreventivo.denominador as number)) * 100, i.cumplimientoPreventivo.valor),
    backlog: i.backlog.detalle.length === i.backlog.valor,
  };
}

async function main() {
  const sufijo = Date.now();
  const ahora = new Date();
  const orgA = await prisma.organization.create({ data: { name: "Prueba integridad A", slug: `pia-${sufijo}`, timezone: ZONA } });
  const orgB = await prisma.organization.create({ data: { name: "Prueba integridad B", slug: `pib-${sufijo}`, timezone: ZONA } });

  try {
    // ─────────────────────────────────────────────────────── Periodos ───
    console.log("\nPeriodos en la zona de la empresa");
    for (const dias of [30, 90, 180, 365]) {
      const p = periodoIndicadores(dias, ZONA, ahora);
      const ant = periodoAnterior(p);
      revisar(`${dias} días: hoy cuenta completo (hasta = medianoche de mañana)`, claveDiaEnZona(new Date(p.hasta.getTime() - 1), ZONA) === claveDiaEnZona(ahora, ZONA));
      revisar(`${dias} días: el anterior termina donde empieza este`, ant.hasta.getTime() === p.desde.getTime());
      revisar(`${dias} días: abarca ${dias} días de calendario`, Math.round((p.hasta.getTime() - p.desde.getTime()) / DIA) === dias);
    }
    const p30 = periodoIndicadores(30, ZONA, ahora);
    revisar("un instante 1 min antes de `desde` no cae; `desde` sí", !caeEn(new Date(p30.desde.getTime() - 60_000), p30) && caeEn(p30.desde, p30));
    revisar("`desde` es medianoche en Monterrey, no en UTC", p30.desde.getUTCHours() !== 0, p30.desde.toISOString());
    const v = ventanas("MES", ahora, ZONA);
    revisar("Dónde para la planta usa la misma ventana que los indicadores",
      v.actual.desde.getTime() === p30.desde.getTime() && v.actual.hasta.getTime() === p30.hasta.getTime());

    // ─────────────────────────────────────────────────── Vencimiento ───
    console.log("\nEtiquetas de vencimiento según el estado");
    const hoyClave = claveDiaEnZona(ahora, ZONA);
    const diaUtc = (offset: number) => new Date(Date.parse(`${hoyClave}T00:00:00Z`) + offset * DIA);
    const et = (o: Parameters<typeof estadoDeVencimiento>[0]) => estadoDeVencimiento(o, { zona: ZONA, ahora }).texto;
    revisar("abierta con compromiso hace 3 días", et({ status: "OPEN", dueDate: diaUtc(-3) }) === "Vencida hace 3 días", et({ status: "OPEN", dueDate: diaUtc(-3) }));
    revisar("abierta que vence hoy", et({ status: "IN_PROGRESS", dueDate: diaUtc(0) }) === "Vence hoy");
    revisar("abierta que vence en 1 día", et({ status: "OPEN", dueDate: diaUtc(1) }) === "Vence en 1 día");
    revisar("terminada el día del compromiso a las 11 pm", et({ status: "COMPLETED", dueDate: diaUtc(-2), completedAt: new Date(medianocheEnZona(...(claveDiaEnZona(diaUtc(-2), "UTC").split("-").map(Number) as [number, number, number]), ZONA).getTime() + 23 * 3_600_000) }) === "Cumplida en fecha");
    revisar("terminada 4 días tarde", et({ status: "CLOSED", dueDate: diaUtc(-6), completedAt: new Date(ahora.getTime() - 2 * DIA) }) === "Terminada con 4 días de atraso", et({ status: "CLOSED", dueDate: diaUtc(-6), completedAt: new Date(ahora.getTime() - 2 * DIA) }));
    revisar("cancelada nunca es vencida", et({ status: "CANCELLED", dueDate: diaUtc(-30) }) === "Cancelada");
    revisar("sin fecha compromiso", et({ status: "OPEN", dueDate: null }) === "Sin fecha compromiso");

    // ───────────────────────────────────────────────────── Indicadores ───
    console.log("\nIndicadores: un caso armado a mano");
    const siteA = await prisma.site.create({ data: { organizationId: orgA.id, code: "P", name: "Planta" } });
    const a1 = await prisma.asset.create({ data: { organizationId: orgA.id, siteId: siteA.id, code: "A1", name: "Compresor", criticality: "A" } });
    const a2 = await prisma.asset.create({ data: { organizationId: orgA.id, siteId: siteA.id, code: "A2", name: "Bomba" } });
    const hace = (d: number) => new Date(ahora.getTime() - d * DIA);
    const ot = (number: string, data: Record<string, unknown>) =>
      prisma.workOrder.create({ data: { organizationId: orgA.id, number, title: number, assetId: a1.id, ...data } });

    const w1 = await ot("W1", { maintenanceType: "CORRECTIVE", status: "COMPLETED", createdAt: hace(10), startedAt: new Date(hace(10).getTime() + 2 * 3_600_000), completedAt: hace(9), actualHours: 4, laborCost: 1000, totalCost: 1000 });
    await ot("W2", { maintenanceType: "CORRECTIVE", status: "CLOSED", createdAt: hace(40), completedAt: hace(5), actualHours: 0, totalCost: 500, partsCost: 500 });
    await ot("W3", { maintenanceType: "PREVENTIVE", status: "COMPLETED", createdAt: hace(8), dueDate: diaUtc(-3), completedAt: hace(3), actualHours: 1, totalCost: 200 });
    const w4 = await ot("W4", { maintenanceType: "PREVENTIVE", status: "COMPLETED", createdAt: hace(8), dueDate: diaUtc(-6), completedAt: hace(2), actualHours: 1, totalCost: 0 });
    await ot("W5", { maintenanceType: "PREVENTIVE", status: "OPEN", createdAt: hace(8), dueDate: diaUtc(-4) });
    await ot("W6", { maintenanceType: "PREVENTIVE", status: "OPEN", createdAt: hace(1), dueDate: diaUtc(5) });
    await ot("W7", { maintenanceType: "CORRECTIVE", status: "CANCELLED", createdAt: hace(8), totalCost: 9999 });
    await ot("W8", { maintenanceType: "PREVENTIVE", status: "COMPLETED", createdAt: hace(100), completedAt: hace(100), actualHours: 1, totalCost: 300 });

    const paro = (assetId: string, startedAt: Date, minutes: number, planned: boolean, workOrderId?: string) =>
      prisma.downtimeEvent.create({ data: { assetId, startedAt, minutes, planned, workOrderId } });
    await paro(a1.id, hace(9), 120, false, w1.id);
    await paro(a1.id, hace(2), 60, true, w4.id);
    await paro(a2.id, hace(100), 600, false);
    await paro(a2.id, new Date(p30.hasta.getTime() + DIA), 999, false); // posterior al periodo: no cuenta
    await paro(a2.id, new Date(p30.desde.getTime() - 60_000), 30, false); // un minuto antes: fuera de 30, dentro de 90
    await paro(a2.id, p30.desde, 30, false); // justo en el borde: dentro

    const k30 = await calcularIndicadores(orgA.id, p30, { ahora });
    const i = k30.indicadores;
    revisar("paro no planeado = 2.5 h (sin el planeado, sin el posterior)", i.paroNoPlaneado.valor === 2.5, i.paroNoPlaneado.valor);
    revisar("paro planeado = 1 h, aparte", i.paroPlaneado.valor === 1, i.paroPlaneado.valor);
    revisar("paro acumulado = 3.5 h", i.paroTotal.valor === 3.5, i.paroTotal.valor);
    const cal = 30 * 24 * 2;
    revisar("disponibilidad descuenta solo el no planeado", cerca(i.disponibilidad.valor, ((cal - 2.5) / cal) * 100, 1e-6), i.disponibilidad.valor);
    revisar("MTBF = (calendario − no planeado) ÷ 1 falla (sin la cancelada ni la creada antes)", cerca(i.mtbf.valor, cal - 2.5, 0.05), i.mtbf.valor);
    revisar("MTTR = 4 h: la reparación sin horas no entra", i.mttr.valor === 4 && i.mttr.notas.length === 1, { valor: i.mttr.valor, notas: i.mttr.notas });
    revisar("cumplimiento = 1 de 3 (en fecha, tarde, vencida; la futura no se juzga)", cerca(i.cumplimientoPreventivo.valor, 100 / 3) && i.cumplimientoPreventivo.denominador === 3, i.cumplimientoPreventivo.valor);
    revisar("costo = 1,700: terminadas en el periodo, sin la cancelada", i.costoMantenimiento.valor === 1700, i.costoMantenimiento.valor);
    revisar("trabajo planificado = 2 de 4 terminadas", cerca(i.trabajoPlanificado.valor, 50), i.trabajoPlanificado.valor);
    revisar("backlog = 2 abiertas, 1 vencida", i.backlog.valor === 2 && k30.totales.backlogVencido === 1, { backlog: i.backlog.valor, vencidas: k30.totales.backlogVencido });
    revisar("canceladas contadas aparte", k30.totales.ordenesCanceladas === 1);
    const cuadra = detalleCuadra(k30);
    revisar("el detalle de cada tarjeta suma exactamente su cifra", Object.values(cuadra).every(Boolean), cuadra);
    revisar("cada indicador trae nombre, definición, fórmula y alcance",
      Object.values(i).every((x) => x.nombre && x.definicion && x.formula && x.alcance.estadosOT && x.alcance.fechaQueCuenta && x.calculo));

    console.log("\nIndicadores en 30, 90, 180 y 365 días");
    const kPor: Record<number, Indicadores> = { 30: k30 };
    for (const d of [90, 180, 365]) kPor[d] = await calcularIndicadores(orgA.id, periodoIndicadores(d, ZONA, ahora), { ahora });
    revisar("90 días suma el paro de un minuto antes del borde de 30", kPor[90].indicadores.paroNoPlaneado.valor === 3, kPor[90].indicadores.paroNoPlaneado.valor);
    revisar("365 días suma el paro de hace 100 días", kPor[365].indicadores.paroNoPlaneado.valor === 13, kPor[365].indicadores.paroNoPlaneado.valor);
    revisar("180 y 365 días incluyen la orden de hace 100 días", kPor[180].indicadores.costoMantenimiento.valor === 2000 && kPor[365].indicadores.costoMantenimiento.valor === 2000);
    revisar("el paro nunca decrece al ampliar el periodo", [30, 90, 180, 365].every((d, j, xs) => j === 0 || (kPor[d].indicadores.paroTotal.valor as number) >= (kPor[xs[j - 1]].indicadores.paroTotal.valor as number)));
    revisar("el detalle cuadra en los cuatro periodos", [30, 90, 180, 365].every((d) => Object.values(detalleCuadra(kPor[d])).every(Boolean)));

    console.log("\nLas mismas cifras en otros módulos");
    const herr = (await ejecutarHerramienta(orgA.id, "indicadores", { dias: 30 })) as { indicadores: Array<{ indicador: string; valor: number | null }> };
    const deIa = (nombre: string) => herr.indicadores.find((x) => x.indicador === nombre)?.valor ?? null;
    revisar("la herramienta de IA da el mismo MTTR", deIa(i.mttr.nombre) === i.mttr.valor, deIa(i.mttr.nombre));
    revisar("la herramienta de IA da la misma disponibilidad", cerca(deIa(i.disponibilidad.nombre), i.disponibilidad.valor as number), deIa(i.disponibilidad.nombre));
    revisar("la herramienta de IA da el mismo costo", deIa(i.costoMantenimiento.nombre) === i.costoMantenimiento.valor);
    const busqueda = (await ejecutarHerramienta(orgA.id, "buscar_ordenes", { dias: 30, soloVencidas: true })) as { total: number };
    revisar("«vencidas» de la IA = vencidas del Panel", busqueda.total === k30.totales.backlogVencido, busqueda.total);

    // ─────────────────────────────────────────────── Aislamiento + OT ───
    console.log("\nAislamiento entre empresas y reapertura de órdenes");
    const siteB = await prisma.site.create({ data: { organizationId: orgB.id, code: "P", name: "Planta B" } });
    const b1 = await prisma.asset.create({ data: { organizationId: orgB.id, siteId: siteB.id, code: "A1", name: "Compresor B" } });
    const userB = await prisma.user.create({ data: { organizationId: orgB.id, email: `b-${sufijo}@x.mx`, name: "B", passwordHash: "x", role: "ADMIN" } });
    await prisma.workOrder.create({ data: { organizationId: orgB.id, number: "W1", title: "B", assetId: b1.id, maintenanceType: "CORRECTIVE", status: "COMPLETED", completedAt: hace(1), totalCost: 5555, actualHours: 9 } });
    await paro(b1.id, hace(1), 500, false);
    const kA = await calcularIndicadores(orgA.id, p30, { ahora });
    revisar("los datos de B no tocan los indicadores de A", kA.indicadores.costoMantenimiento.valor === 1700 && kA.indicadores.paroNoPlaneado.valor === 2.5 && kA.indicadores.mttr.valor === 4);

    const reabre = await prisma.workOrder.create({ data: { organizationId: orgB.id, number: "R1", title: "Reabrir", assetId: b1.id, maintenanceType: "CORRECTIVE", status: "IN_PROGRESS", startedAt: hace(1) } });
    await transitionWorkOrder({ workOrderId: reabre.id, to: "COMPLETED", userId: userB.id, organizationId: orgB.id, downtimeMinutes: 45 });
    await transitionWorkOrder({ workOrderId: reabre.id, to: "IN_PROGRESS", userId: userB.id, organizationId: orgB.id });
    const reabierta = await prisma.workOrder.findUniqueOrThrow({ where: { id: reabre.id } });
    revisar("reabrir borra la fecha de finalización", reabierta.completedAt === null);
    const pB = periodoIndicadores(30, ZONA, new Date());
    const kB1 = await calcularIndicadores(orgB.id, pB);
    revisar("una orden reabierta no cuenta como terminada", !kB1.indicadores.costoMantenimiento.detalle.some((r) => r.id === reabre.id));
    await transitionWorkOrder({ workOrderId: reabre.id, to: "COMPLETED", userId: userB.id, organizationId: orgB.id, downtimeMinutes: 50 });
    const eventos = await prisma.downtimeEvent.findMany({ where: { workOrderId: reabre.id } });
    revisar("completar de nuevo corrige el paro en vez de duplicarlo", eventos.length === 1 && eventos[0].minutes === 50, eventos.map((e) => e.minutes));
    const bitacora = await prisma.auditLog.findFirst({ where: { organizationId: orgB.id, entityId: reabre.id, changes: { contains: "completedAtAnterior" } } });
    revisar("la fecha borrada queda en la bitácora", Boolean(bitacora));

    // ─────────────────────────────────────────────────────── Medidores ───
    console.log("\nMedidores: validación pura");
    type MedidorPrueba = { tipo: string; unit: string; maxIncrementoDiario: number | null; dailyAverage: number };
    const hor: MedidorPrueba = { tipo: "HOROMETRO", unit: "h", maxIncrementoDiario: null, dailyAverage: 10 };
    const t = (d: number) => new Date(ahora.getTime() - d * DIA);
    const val = (anterior: { value: number; readingAt: Date } | null, value: number, readingAt: Date, medidor = hor, tipo: "LECTURA" | "REINICIO" | "SUSTITUCION" = "LECTURA", motivo?: string) =>
      validarLectura({ medidor, anterior: anterior && { ...anterior, tipo: "LECTURA" }, siguiente: null, nueva: { value, readingAt, tipo, motivo }, ahora });
    revisar("lectura normal", val({ value: 100, readingAt: t(2) }, 120, t(1)).nivel === "OK");
    revisar("menor que la anterior: bloqueada", val({ value: 100, readingAt: t(2) }, 90, t(1)).codigo === "MENOR_QUE_ANTERIOR");
    const imposible = val({ value: 18420, readingAt: t(4) }, 20500, t(0));
    revisar("horómetro con más horas que el reloj: bloqueado (el caso CMP-301)", imposible.codigo === "HORAS_IMPOSIBLES" && imposible.nivel === "ERROR");
    revisar("el mensaje dice anterior, nueva, incremento, horas naturales, máximo y alternativas",
      ["18,420", "20,500", "2,080", "Horas naturales transcurridas", "Máximo permitido: 96 h", "corregir la lectura", "sustitución", "reinicio"].every((x) => imposible.mensaje.includes(x)) &&
      imposible.contexto.maximoPermitido === 96 && imposible.contexto.alternativas.length === 3, imposible.mensaje);
    revisar("reinicio sin motivo: bloqueado", val({ value: 100, readingAt: t(2) }, 0, t(1), hor, "REINICIO").codigo === "FALTA_MOTIVO");
    revisar("reinicio con motivo: puede bajar", val({ value: 100, readingAt: t(2) }, 0, t(1), hor, "REINICIO", "cambio").nivel === "OK");
    const odo = { tipo: "ODOMETRO", unit: "km", maxIncrementoDiario: 500, dailyAverage: 200 };
    const aviso = val({ value: 1000, readingAt: t(2) }, 2500, t(1), odo);
    revisar("odómetro sobre el máximo configurado: advertencia con contexto", aviso.nivel === "ADVERTENCIA" && aviso.contexto.incremento === 1500 && cerca(aviso.contexto.horasTranscurridas, 24), aviso.contexto);
    revisar("fecha futura: bloqueada", val({ value: 100, readingAt: t(2) }, 110, new Date(ahora.getTime() + DIA)).codigo === "FECHA_FUTURA");

    console.log("\nMedidores: registro, corrección, anulación y reinicio");
    const userA = await prisma.user.create({ data: { organizationId: orgA.id, email: `a-${sufijo}@x.mx`, name: "A", passwordHash: "x", role: "ADMIN" } });
    const medidor = await prisma.meter.create({ data: { organizationId: orgA.id, assetId: a1.id, name: "Horómetro", unit: "h", tipo: "HOROMETRO" } });
    const plan = await prisma.maintenancePlan.create({ data: { organizationId: orgA.id, name: "Servicio 500 h", triggerType: "METER", intervalMeter: 500 } });
    const asig = await prisma.planAsset.create({ data: { organizationId: orgA.id, planId: plan.id, assetId: a1.id, meterId: medidor.id, nextDueMeter: 1500 } });
    const reg = (value: number, readingAt: Date, extra: Partial<Parameters<typeof registrarLectura>[0]> = {}) =>
      registrarLectura({ organizationId: orgA.id, meterId: medidor.id, userId: userA.id, value, readingAt, ahora, ...extra });

    await reg(1000, t(20));
    await reg(1100, t(15));
    revisar("menor que la anterior: rechazada", (await lanza(() => reg(1050, t(14)))) === "MENOR_QUE_ANTERIOR");
    revisar("200 h en 24 h de reloj: rechazada", (await lanza(() => reg(1300, t(14)))) === "HORAS_IMPOSIBLES");
    revisar("y ni confirmando con justificación se acepta",
      (await lanza(() => reg(1300, t(14), { confirmar: true, justificacion: "Lo vi yo" }))) === "HORAS_IMPOSIBLES");
    await reg(1115, t(14));
    let m = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } });
    revisar("promedio desde el historial: 115 h en 6 días", cerca(m.dailyAverage, 115 / 6), m.dailyAverage);
    await prisma.meter.update({ where: { id: medidor.id }, data: { maxIncrementoDiario: 16 } });
    const r6a = await reg(1138, t(13));
    revisar("sobre el máximo diario: no se guarda sin confirmar", !r6a.ok && r6a.requiereConfirmacion);
    const r6b = await reg(1138, t(13), { confirmar: true });
    revisar("confirmar sin justificación tampoco", !r6b.ok);
    const r6 = await reg(1138, t(13), { confirmar: true, justificacion: "Operó doble turno por pedido urgente" });
    revisar("con justificación se acepta como atípica", r6.ok);
    const lectura6 = r6.ok ? await prisma.meterReading.findUniqueOrThrow({ where: { id: r6.lecturaId } }) : null;
    revisar("queda marcada atípica con su justificación", lectura6?.atipica === true && Boolean(lectura6?.justificacion));
    revisar("y en la bitácora", Boolean(await prisma.auditLog.findFirst({ where: { organizationId: orgA.id, entityId: lectura6?.id, action: "LECTURA_ATIPICA" } })));
    let a = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig.id } });
    m = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } });
    // Desde la medianoche de hoy en la zona de la empresa: asi el recalculo es idempotente.
    const hoyEnZona = medianocheEnZona(...(claveDiaEnZona(ahora, ZONA).split("-").map(Number) as [number, number, number]), ZONA);
    const esperada = (actual: number, prom: number) => hoyEnZona.getTime() + Math.ceil((1500 - actual) / prom) * DIA;
    revisar("el plan por uso recalcula su fecha estimada", Math.abs((a.nextDueDate?.getTime() ?? 0) - esperada(1138, m.dailyAverage)) < 1000, a.nextDueDate?.toISOString());

    const corr = await corregirLectura({ organizationId: orgA.id, readingId: lectura6!.id, userId: userA.id, value: 1130, motivo: "Se leyó mal un dígito", ahora });
    const corregida = await prisma.meterReading.findUniqueOrThrow({ where: { id: lectura6!.id } });
    revisar("la corrección conserva original, corregido, usuario, fecha y motivo",
      corr.ok && corregida.valorOriginal === 1138 && corregida.value === 1130 && corregida.correccionPorId === userA.id && Boolean(corregida.correccionEl) && corregida.correccionMotivo === "Se leyó mal un dígito" && corregida.estado === "CORREGIDA");
    m = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } });
    a = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig.id } });
    revisar("tras corregir: valor actual y promedio recalculados", m.currentValue === 1130 && cerca(m.dailyAverage, 130 / 7), { actual: m.currentValue, prom: m.dailyAverage });
    revisar("tras corregir: el plan por uso se recalcula", Math.abs((a.nextDueDate?.getTime() ?? 0) - esperada(1130, m.dailyAverage)) < 1000);
    const idLectura5 = (await prisma.meterReading.findFirstOrThrow({ where: { meterId: medidor.id, value: 1115 } })).id;
    revisar("corregir por encima de la lectura siguiente: rechazado",
      (await lanza(() => corregirLectura({ organizationId: orgA.id, readingId: idLectura5, userId: userA.id, value: 1200, motivo: "x", ahora }))) === "MAYOR_QUE_SIGUIENTE");

    const antes = await prisma.meterReading.count({ where: { meterId: medidor.id } });
    await anularLectura({ organizationId: orgA.id, readingId: lectura6!.id, userId: userA.id, motivo: "Duplicada", ahora });
    m = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } });
    revisar("anular no borra la lectura", (await prisma.meterReading.count({ where: { meterId: medidor.id } })) === antes);
    revisar("anular recalcula sin ella", m.currentValue === 1115 && cerca(m.dailyAverage, 115 / 6), { actual: m.currentValue, prom: m.dailyAverage });

    revisar("reinicio sin motivo: rechazado", (await lanza(() => reg(0, t(12), { tipo: "REINICIO" }))) === "FALTA_MOTIVO");
    await reg(0, t(12), { tipo: "SUSTITUCION", justificacion: "Horómetro dañado, se instaló uno nuevo" });
    a = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig.id } });
    revisar("la sustitución recorre la meta del plan: faltaban 385 h", a.nextDueMeter === 385, a.nextDueMeter);
    revisar("después del cambio, una lectura baja respecto al medidor viejo es válida", (await lanza(() => reg(10, t(11)))) === null);
    m = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } });
    revisar("el promedio no mezcla medidor viejo y nuevo (1 día de tramo nuevo)", cerca(m.dailyAverage, 10), m.dailyAverage);
    const sust = await prisma.meterReading.findFirstOrThrow({ where: { meterId: medidor.id, tipo: "SUSTITUCION" } });
    revisar("la sustitución guarda el valor de antes para poder deshacerse", sust.valorAnterior === 1115, sust.valorAnterior);

    console.log("\nMedidores: corregir y anular reinicios o sustituciones");
    revisar("anularla dejaría la lectura posterior sin continuidad: se niega y dice por qué",
      (await lanza(() => anularLectura({ organizationId: orgA.id, readingId: sust.id, userId: userA.id, motivo: "Capturada por error", ahora }))) === "ROMPE_CONTINUIDAD");
    revisar("corregirla a un arranque mayor que la lectura siguiente: se niega",
      (await lanza(() => corregirLectura({ organizationId: orgA.id, readingId: sust.id, userId: userA.id, value: 20, motivo: "x", ahora }))) === "ROMPE_CONTINUIDAD");
    await corregirLectura({ organizationId: orgA.id, readingId: sust.id, userId: userA.id, value: 5, tipo: "REINICIO", motivo: "Fue reinicio, arrancó en 5", ahora });
    const sustCorr = await prisma.meterReading.findUniqueOrThrow({ where: { id: sust.id } });
    a = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig.id } });
    revisar("corregida: conserva valor, tipo, usuario y fecha originales, y quién corrigió",
      sustCorr.valorOriginal === 0 && sustCorr.tipoOriginal === "SUSTITUCION" && sustCorr.tipo === "REINICIO" && sustCorr.value === 5 &&
      sustCorr.userId === userA.id && Boolean(sustCorr.fechaOriginal) && sustCorr.correccionPorId === userA.id && Boolean(sustCorr.correccionEl));
    revisar("y la meta del plan se recorre por la diferencia (385 → 390)", a.nextDueMeter === 390, a.nextDueMeter);
    const lectura10 = await prisma.meterReading.findFirstOrThrow({ where: { meterId: medidor.id, value: 10, estado: { not: "ANULADA" } } });
    await anularLectura({ organizationId: orgA.id, readingId: lectura10.id, userId: userA.id, motivo: "Del medidor equivocado", ahora });
    await anularLectura({ organizationId: orgA.id, readingId: sust.id, userId: userA.id, motivo: "El reinicio nunca ocurrió", ahora });
    a = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig.id } });
    m = await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } });
    revisar("anulado el reinicio: la meta regresa a 1,500 y el medidor a 1,115", a.nextDueMeter === 1500 && m.currentValue === 1115, { meta: a.nextDueMeter, actual: m.currentValue });
    revisar("el evento sigue ahí, anulado, con motivo", (await prisma.meterReading.findUniqueOrThrow({ where: { id: sust.id } })).estado === "ANULADA");
    revisar("queda en la bitácora", (await prisma.auditLog.count({ where: { organizationId: orgA.id, entityId: sust.id, action: { in: ["CORREGIDA", "ANULADA"] } } })) === 2);

    console.log("\nMedidores: sin lectura vigente");
    const m2 = await prisma.meter.create({ data: { organizationId: orgA.id, assetId: a2.id, name: "Horómetro B", unit: "h", tipo: "HOROMETRO" } });
    const plan2 = await prisma.maintenancePlan.create({ data: { organizationId: orgA.id, name: "Servicio B", triggerType: "METER", intervalMeter: 100 } });
    const asig2 = await prisma.planAsset.create({ data: { organizationId: orgA.id, planId: plan2.id, assetId: a2.id, meterId: m2.id, nextDueMeter: 300 } });
    const l1 = await registrarLectura({ organizationId: orgA.id, meterId: m2.id, userId: userA.id, value: 100, readingAt: t(5), ahora });
    const l2 = await registrarLectura({ organizationId: orgA.id, meterId: m2.id, userId: userA.id, value: 110, readingAt: t(4), ahora });
    if (l1.ok && l2.ok) {
      await anularLectura({ organizationId: orgA.id, readingId: l2.lecturaId, userId: userA.id, motivo: "error", ahora });
      await anularLectura({ organizationId: orgA.id, readingId: l1.lecturaId, userId: userA.id, motivo: "error", ahora });
    }
    const m2d = await prisma.meter.findUniqueOrThrow({ where: { id: m2.id } });
    const a2d = await prisma.planAsset.findUniqueOrThrow({ where: { id: asig2.id } });
    revisar("todas anuladas y sin valor inicial: «sin lectura vigente», sin actual ni promedio",
      m2d.lecturaVigente === false && m2d.currentValue === 0 && m2d.dailyAverage === 0 && m2d.lastReadingAt === null, m2d);
    revisar("y no se proyecta el plan con una lectura anulada", a2d.nextDueDate === null);
    const m3 = await prisma.meter.create({ data: { organizationId: orgA.id, assetId: a2.id, name: "Contador C", unit: "ciclos", tipo: "CICLOS", currentValue: 50, valorInicial: 50, valorInicialEl: t(30) } });
    const l3 = await registrarLectura({ organizationId: orgA.id, meterId: m3.id, userId: userA.id, value: 60, readingAt: t(3), ahora });
    if (l3.ok) await anularLectura({ organizationId: orgA.id, readingId: l3.lecturaId, userId: userA.id, motivo: "error", ahora });
    const m3d = await prisma.meter.findUniqueOrThrow({ where: { id: m3.id } });
    revisar("con valor inicial formal: vuelve al valor inicial", m3d.lecturaVigente && m3d.currentValue === 50);
    revisar("una lectura nueva devuelve la vigencia", (await registrarLectura({ organizationId: orgA.id, meterId: m2.id, userId: userA.id, value: 120, readingAt: t(1), ahora })).ok &&
      (await prisma.meter.findUniqueOrThrow({ where: { id: m2.id } })).lecturaVigente === true);

    console.log("\nRecálculo: ensayo e idempotencia");
    await prisma.meter.update({ where: { id: medidor.id }, data: { dailyAverage: 99 } });
    const ensayo = await planearRecalculo(prisma, orgA.id, medidor.id, ahora, ZONA);
    revisar("el ensayo detecta el promedio desviado", ensayo.registrosAModificar > 0 && cerca(ensayo.antes.dailyAverage, 99) && !cerca(ensayo.despues.dailyAverage, 99));
    revisar("y no escribe nada", (await prisma.meter.findUniqueOrThrow({ where: { id: medidor.id } })).dailyAverage === 99);
    await recalcularMedidor(orgA.id, medidor.id, ahora);
    const segunda = await planearRecalculo(prisma, orgA.id, medidor.id, ahora, ZONA);
    revisar("aplicado una vez, la segunda corrida no cambia nada", segunda.registrosAModificar === 0, segunda.registrosAModificar);
    const conLegado = await prisma.meter.create({ data: { organizationId: orgA.id, assetId: a2.id, name: "Horómetro legado", unit: "h", tipo: "HOROMETRO" } });
    await prisma.meterReading.createMany({ data: [
      { organizationId: orgA.id, meterId: conLegado.id, value: 18420, readingAt: t(6) },
      { organizationId: orgA.id, meterId: conLegado.id, value: 20500, readingAt: t(2) },
    ] });
    const planLegado = await planearRecalculo(prisma, orgA.id, conLegado.id, ahora, ZONA);
    revisar("la lectura imposible se reporta y NO se corrige", planLegado.lecturasSospechosas.length === 1 && planLegado.despues.currentValue === 20500, planLegado.lecturasSospechosas);
    revisar("otra empresa no puede planear sobre este medidor", (await lanza(() => planearRecalculo(prisma, orgB.id, conLegado.id, ahora))) === "Medidor no encontrado");
    revisar("otra empresa no puede registrar en este medidor",
      (await lanza(() => registrarLectura({ organizationId: orgB.id, meterId: medidor.id, userId: userB.id, value: 20, ahora }))) === "Medidor no encontrado");
    revisar("ni corregir sus lecturas",
      (await lanza(() => corregirLectura({ organizationId: orgB.id, readingId: idLectura5, userId: userB.id, value: 1, motivo: "x", ahora }))) === "Lectura no encontrada");

    // ────────────────────────────────────────────────────── Predictivo ───
    console.log("\nPredictivo: evaluación pura");
    const umbrales = { warningThreshold: 4.5, criticalThreshold: 7.1, direction: "ABOVE", unit: "mm/s" };
    const serie = (valores: number[], cadaHoras = 24) =>
      valores.map((value, j) => ({ value, readingAt: new Date(ahora.getTime() - (valores.length - 1 - j) * cadaHoras * 3_600_000) }));
    const pocas = evaluarPunto(serie([3, 3.2, 3.4]), umbrales, ahora);
    revisar("con 3 lecturas: datos insuficientes, sin fecha", pocas.confianza === "INSUFICIENTE" && pocas.cruceCritico.texto === "Datos insuficientes para proyectar" && pocas.cruceCritico.fecha === null);
    const estableArriba = evaluarPunto(serie(Array(10).fill(8)), umbrales, ahora);
    revisar("estable sobre el crítico sigue siendo CRÍTICO", estableArriba.estado === "CRITICO" && estableArriba.tendencia === "ESTABLE", estableArriba.resumen);
    revisar("y lo dice: umbral crítico superado, sin mejora", /Umbral crítico superado/.test(estableArriba.resumen) && /sin mejora/.test(estableArriba.resumen) && estableArriba.cruceCritico.texto === "Umbral ya superado");
    const sube = evaluarPunto(serie([2, 2.2, 2.4, 2.6, 2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0]), umbrales, ahora);
    revisar("tendencia al alza: advertencia y crítico con fechas separadas y futuras",
      sube.estado === "NORMAL" && sube.tendencia === "EMPEORA" && !!sube.cruceAdvertencia.fecha && !!sube.cruceCritico.fecha &&
      sube.cruceAdvertencia.fecha < sube.cruceCritico.fecha && sube.cruceAdvertencia.fecha > ahora, { adv: sube.cruceAdvertencia.texto, crit: sube.cruceCritico.texto });
    revisar("confianza en palabras, sin porcentaje", !/%/.test(sube.etiquetaConfianza) && sube.confianza === "ALTA", sube.etiquetaConfianza);
    revisar("una fecha guardada que ya pasó se lee «Proyección vencida»", textoDeCruce(new Date(ahora.getTime() - 5 * DIA), ahora).texto.startsWith("Proyección vencida"));
    const baja = evaluarPunto(serie([60, 58, 56, 54, 52, 50]), { warningThreshold: 45, criticalThreshold: 40, direction: "BELOW" }, ahora);
    revisar("sensor de mínimo (presión que baja) proyecta hacia abajo", baja.tendencia === "EMPEORA" && !!baja.cruceCritico.fecha);

    console.log("\nPredictivo: una alerta por punto, escalamiento y normalización");
    const sensor = await prisma.sensor.create({ data: { organizationId: orgA.id, assetId: a1.id, name: "Vibración", sensorType: "VIBRATION", unit: "mm/s", warningThreshold: 4.5, criticalThreshold: 7.1 } });
    const ingesta = (value: number, dHoras: number) =>
      ingestSensorReading({ organizationId: orgA.id, sensorId: sensor.id, value, readingAt: new Date(ahora.getTime() - dHoras * 3_600_000), ahora, userId: userA.id });
    const valores = [3.0, 3.3, 3.6, 3.9, 4.2, 4.4];
    for (let j = 0; j < valores.length; j++) await ingesta(valores[j], (valores.length - j) * 24 + 10);
    const alertas = () => prisma.predictiveAlert.findMany({ where: { organizationId: orgA.id, sensorId: sensor.id } });
    let al = await alertas();
    revisar("tendencia hacia el crítico en ≤30 días abre UNA alerta", al.length === 1 && al[0].condicion === "TENDENCIA", al.map((x) => x.condicion));
    await ingesta(4.8, 8);
    al = await alertas();
    revisar("pasa a advertencia: se escala la misma alerta", al.length === 1 && al[0].condicion === "ADVERTENCIA");
    const r = await ingesta(7.5, 6);
    await ingesta(7.5, 4);
    al = await alertas();
    revisar("pasa a crítico: misma alerta, crítica, con una sola OT predictiva",
      al.length === 1 && al[0].severity === "CRITICAL" && Boolean(r.workOrderNumber) &&
      (await prisma.workOrder.count({ where: { organizationId: orgA.id, maintenanceType: "PREDICTIVE" } })) === 1);
    revisar("ninguna alerta activa guarda un cruce anterior a su detección",
      al.every((x) => !x.fechaCruceCritico || x.fechaCruceCritico >= x.createdAt) && al[0].estadoActual === "CRITICO");

    console.log("\nPredictivo: completar o cerrar la OT no toca la alerta");
    const otPred = await prisma.workOrder.findFirstOrThrow({ where: { organizationId: orgA.id, maintenanceType: "PREDICTIVE" } });
    await transitionWorkOrder({ workOrderId: otPred.id, to: "IN_PROGRESS", userId: userA.id, organizationId: orgA.id });
    await transitionWorkOrder({ workOrderId: otPred.id, to: "COMPLETED", userId: userA.id, organizationId: orgA.id });
    al = await alertas();
    revisar("completada la OT con el punto crítico: la alerta sigue abierta y crítica",
      al.length === 1 && al[0].status === "OPEN" && al[0].severity === "CRITICAL" && al[0].normalizadaEl === null, al.map((x) => x.status));
    await transitionWorkOrder({ workOrderId: otPred.id, to: "CLOSED", userId: userA.id, organizationId: orgA.id });
    al = await alertas();
    revisar("cerrada la OT: la alerta sigue igual", al[0].status === "OPEN" && al[0].normalizadaEl === null);
    revisar("no se puede resolver mientras siga fuera de rango",
      "error" in (await validarNormalizacion({ organizationId: orgA.id, alertId: al[0].id, userId: userA.id, ahora })));

    const r2 = await ingesta(2.0, 3);
    al = await alertas();
    const evidencia = await prisma.sensorReading.findFirst({ where: { id: al[0].normalizacionLecturaId ?? "" } });
    revisar("al normalizar no se resuelve sola: queda por validar", al.length === 1 && al[0].status === "OPEN" && Boolean(al[0].normalizadaEl) && r2.condicion === null);
    revisar("y guarda la lectura que lo mostró como evidencia", evidencia?.value === 2 && al[0].normalizacionValor === 2);
    await ingesta(7.6, 2);
    al = await alertas();
    revisar("si vuelve a subir, se limpia la normalización y su evidencia", al[0].normalizadaEl === null && al[0].normalizacionLecturaId === null && al.length === 1);
    await ingesta(2.1, 1);
    al = await alertas();
    revisar("la validación de otra empresa no alcanza esta alerta",
      "error" in (await validarNormalizacion({ organizationId: orgB.id, alertId: al[0].id, userId: userB.id, ahora })));
    const val2 = await validarNormalizacion({ organizationId: orgA.id, alertId: al[0].id, userId: userA.id, ahora });
    al = await alertas();
    revisar("validada: resuelta con quién, cuándo y la lectura de evidencia",
      "alerta" in val2 && al[0].status === "RESOLVED" && al[0].resueltaPorId === userA.id && Boolean(al[0].resueltaEl) &&
      al[0].normalizacionValor === 2.1 && Boolean(al[0].resolucion));
    revisar("la validación queda en la bitácora", Boolean(await prisma.auditLog.findFirst({ where: { organizationId: orgA.id, entityId: al[0].id, action: "NORMALIZACION_VALIDADA" } })));

    // ─────────────────────────────────────────── Rutinas diarias ───
    console.log("\nRutinas diarias: confirmación explícita");
    const tarea = (title: string, cadaCuanto: number, unidadFrecuencia: "DIAS" | "SEMANAS" | "MESES", confirmarDiaria?: boolean) =>
      esquemaTarea.parse({ title, cadaCuanto, unidadFrecuencia, confirmarDiaria });
    revisar("una diaria sin confirmar se detecta", JSON.stringify(diariasSinConfirmar([tarea("Purga", 1, "DIAS"), tarea("Aceite", 1, "MESES")], 7)) === JSON.stringify(["Purga"]));
    revisar("confirmada ya no se pide", diariasSinConfirmar([tarea("Purga", 1, "DIAS", true)], 7).length === 0);
    revisar("en planes por medidor no aplica", diariasSinConfirmar([tarea("Purga", 1, "DIAS")], 7, "METER").length === 0);
    const planDiario = await prisma.maintenancePlan.create({ data: { organizationId: orgA.id, name: "Rutina de turno", triggerType: "CALENDAR", intervalDays: 7 } });
    await reemplazarTareas(planDiario.id, [tarea("Purga de condensados", 1, "DIAS", true), tarea("Revisión semanal", 1, "SEMANAS")], 7, { organizationId: orgA.id, userId: userA.id, ahora });
    let purga = await prisma.planTask.findFirstOrThrow({ where: { planId: planDiario.id, title: "Purga de condensados" } });
    revisar("confirmada: guarda quién y cuándo", purga.diariaConfirmadaPorId === userA.id && Boolean(purga.diariaConfirmadaEl));
    const primeraConfirmacion = purga.diariaConfirmadaEl;
    await reemplazarTareas(planDiario.id, [tarea("Purga de condensados", 1, "DIAS", true), tarea("Revisión semanal", 1, "SEMANAS")], 7, { organizationId: orgA.id, userId: userB.id, ahora: new Date(ahora.getTime() + 60_000) });
    purga = await prisma.planTask.findFirstOrThrow({ where: { planId: planDiario.id, title: "Purga de condensados" } });
    revisar("editar el plan conserva la confirmación original", purga.diariaConfirmadaPorId === userA.id && purga.diariaConfirmadaEl?.getTime() === primeraConfirmacion?.getTime());
    let reglasDiarias = await revisarCalidad(orgA.id, ahora);
    revisar("una diaria confirmada no es problema de calidad", !reglasDiarias.find((x) => x.clave === "frecuencia-atipica")!.hallazgos.some((h) => h.id === purga.id));
    await reemplazarTareas(planDiario.id, [tarea("Purga de condensados", 2, "DIAS"), tarea("Revisión semanal", 1, "SEMANAS")], 7, { organizationId: orgA.id, userId: userA.id, ahora });
    purga = await prisma.planTask.findFirstOrThrow({ where: { planId: planDiario.id, title: "Purga de condensados" } });
    revisar("deja de ser diaria: la confirmación se retira", purga.diariaConfirmadaEl === null && purga.id === purga.id);
    revisar("con rastro en la bitácora", Boolean(await prisma.auditLog.findFirst({ where: { organizationId: orgA.id, entityId: purga.id, action: "CONFIRMACION_DIARIA_RETIRADA" } })));
    const sinConfirmar = await prisma.planTask.create({ data: { planId: planDiario.id, title: "Diaria importada", cadaCuanto: 1, unidadFrecuencia: "DIAS", position: 9 } });
    reglasDiarias = await revisarCalidad(orgA.id, ahora);
    revisar("una diaria sin confirmar (importada) aparece como advertencia",
      reglasDiarias.find((x) => x.clave === "frecuencia-atipica")!.hallazgos.some((h) => h.id === sinConfirmar.id) &&
      reglasDiarias.find((x) => x.clave === "frecuencia-atipica")!.nivel === "ADVERTENCIA");

    // ───────────────────────────────────────── IA y zona horaria ───
    console.log("\nIA: ficha de activo y zona horaria");
    const ficha = (await ejecutarHerramienta(orgA.id, "consultar_activo", { codigo: "A1" })) as { planes?: Array<{ plan: string }>; plans?: unknown };
    revisar("la ficha de activo de la IA lee las asignaciones, no el encabezado del plan",
      Boolean(ficha.planes?.some((p) => p.plan === "Servicio 500 h")) && ficha.plans === undefined, ficha.planes);
    const once = new Date("2026-09-17T04:30:00Z"); // 11:30 pm del 16 en Monterrey
    revisar("una fecha con zona de empresa no se recorre al día siguiente", formatDate(once, ZONA).includes("16") && formatDateTime(once, ZONA).includes("16"), formatDateTime(once, ZONA));

    // ─────────────────────────────────────────────── Calidad de datos ───
    console.log("\nCalidad de datos: reglas");
    revisar("compra a futuro: impide guardar", validarFechasDeActivo({ purchaseDate: new Date(ahora.getTime() + 5 * DIA) }, ahora) !== null);
    revisar("garantía antes de la compra: impide guardar", validarFechasDeActivo({ purchaseDate: t(10), warrantyExpiry: t(20) }, ahora) !== null);
    revisar("fechas coherentes: pasa", validarFechasDeActivo({ purchaseDate: t(20), warrantyExpiry: t(10) }, ahora) === null);

    const negativo = await ot("NEG", { status: "OPEN", laborCost: -50 });
    const futuro = await prisma.asset.create({ data: { organizationId: orgA.id, siteId: siteA.id, code: "A3", name: "Torno", criticality: "A", purchaseDate: new Date(ahora.getTime() + 30 * DIA) } });
    const legado = await prisma.meter.create({ data: { organizationId: orgA.id, assetId: a2.id, name: "Horómetro viejo", unit: "h", tipo: "HOROMETRO" } });
    await prisma.meterReading.createMany({ data: [
      { organizationId: orgA.id, meterId: legado.id, value: 18420, readingAt: t(6) },
      { organizationId: orgA.id, meterId: legado.id, value: 20500, readingAt: t(2) },
    ] });
    const alertaVieja = await prisma.predictiveAlert.create({ data: { organizationId: orgA.id, assetId: a2.id, title: "Alerta vieja", message: "x", createdAt: t(5), projectedFailureAt: t(30) } });
    const fin = await prisma.workOrder.create({ data: { organizationId: orgA.id, number: "REV", title: "Al revés", assetId: a2.id, status: "COMPLETED", startedAt: t(1), completedAt: t(2) } });

    const reglas = await revisarCalidad(orgA.id, ahora);
    const tiene = (clave: string, id: string) => reglas.find((x) => x.clave === clave)?.hallazgos.some((h) => h.id === id) ?? false;
    revisar("costo negativo → error", tiene("costos-negativos", negativo.id) && reglas.find((x) => x.clave === "costos-negativos")?.nivel === "ERROR");
    revisar("compra a futuro existente → error", tiene("fechas-de-activo", futuro.id));
    revisar("horómetro con uso imposible (dato viejo) → error", tiene("medidores-imposibles", legado.id));
    revisar("alerta con fecha anterior a su detección → advertencia", tiene("alertas-fechas-incoherentes", alertaVieja.id));
    revisar("término antes de inicio → error", tiene("fechas-termino-antes-de-inicio", fin.id));
    revisar("activo crítico sin plan → advertencia", tiene("criticos-sin-plan", futuro.id) && !tiene("criticos-sin-plan", a1.id));
    revisar("reparación terminada sin horas → advertencia", reglas.find((x) => x.clave === "ot-sin-horas")!.hallazgos.some((h) => h.etiqueta.startsWith("W2")));
    revisar("las reglas no modifican los datos", (await prisma.meterReading.count({ where: { meterId: legado.id } })) === 2 && (await prisma.workOrder.findUniqueOrThrow({ where: { id: negativo.id } })).laborCost === -50);
    const salud = await saludDeDatos(orgA.id, ahora);
    revisar("el índice de captura sale de las mismas reglas", salud.revisiones.length === reglas.length && salud.indice >= 0 && salud.indice <= 100, salud.indice);
    revisar("los huecos empiezan por los errores", salud.huecos[0]?.nivel === "ERROR", salud.huecos[0]?.clave);
    const reglasB = await revisarCalidad(orgB.id, ahora);
    revisar("la calidad de B no ve registros de A", !reglasB.some((x) => x.hallazgos.some((h) => [negativo.id, futuro.id, legado.id, alertaVieja.id, fin.id].includes(h.id))));
  } finally {
    await prisma.organization.delete({ where: { id: orgA.id } });
    await prisma.organization.delete({ where: { id: orgB.id } });
  }

  console.log(fallas ? `\n${fallas} fallas\n` : "\nTodo bien\n");
  await prisma.$disconnect();
  process.exit(fallas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
