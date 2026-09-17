/**
 * La UNICA fuente de los indicadores de mantenimiento.
 *
 * Panel de control, Reportes, Dónde para la planta, el expediente del
 * Diagnóstico IA y las herramientas de consulta de la IA leen de aqui. Antes
 * cada uno tenia su version y daban cifras distintas para el mismo periodo:
 *
 *  - El periodo era "ahora menos N dias" al milisegundo, en UTC.
 *  - Las ordenes se tomaban por fecha de CREACION: una orden creada antes y
 *    terminada dentro del periodo no contaba, y su costo caia en otro mes.
 *  - Las canceladas entraban al total, a los costos y al cumplimiento.
 *  - Una orden reabierta conservaba su fecha de terminacion y se contaba como
 *    completada.
 *  - El paro salia de tres lugares —eventos de paro, el encabezado de la orden
 *    y cada actividad— y el paro PLANEADO restaba disponibilidad como si fuera
 *    una falla.
 *  - El paro no tenia limite superior: un periodo incluia todo lo posterior.
 *  - Sin fallas, el MTBF mostraba el periodo entero como si fuera un dato.
 *
 * Cada indicador declara su definicion, formula y alcance, y entrega los
 * registros que lo forman para que el detalle sume exactamente lo que dice la
 * tarjeta.
 */
import { prisma } from "./db";
import { REGLA_DE_FALLA, clasificarFalla, solicitudesDeFalla } from "./fallas";
import {
  periodoIndicadores, periodoAnterior, dentroDe, caeEn, claveDiaEnZona,
  ZONA_POR_OMISION, type Periodo,
} from "./periodos";
import {
  ESTADOS_ABIERTOS, ESTADOS_TERMINADOS, estadoDeVencimiento, diaDelCompromiso,
} from "./vencimiento";

const HORA = 3_600_000;

/** Tipos que se programan con fecha compromiso: los que mide el cumplimiento. */
export const TIPOS_PROGRAMADOS = ["PREVENTIVE", "INSPECTION"] as const;
/** Apoyos a produccion: no son mantenimiento planeado ni falla. */
export const TIPOS_FUERA_DE_MANTENIMIENTO = ["SUPPORT"] as const;

export type ClaveIndicador =
  | "paroTotal"
  | "paroNoPlaneado"
  | "paroPlaneado"
  | "disponibilidad"
  | "mttr"
  | "mtbf"
  | "cumplimientoPreventivo"
  | "tiempoRespuesta"
  | "trabajoPlanificado"
  | "backlog"
  | "costoMantenimiento";

export type Renglon = {
  /** Id de la orden o del evento de paro. */
  id: string;
  tipo: "ORDEN" | "PARO";
  /** Folio de la orden (o de la orden del paro). */
  folio: string | null;
  workOrderId: string | null;
  titulo: string;
  activo: string | null;
  fecha: Date | null;
  /** Lo que este renglon aporta a la cifra, en la unidad del indicador (o a su numerador). */
  aporte: number;
  /** Para indicadores de proporcion: si cuenta a favor. */
  aFavor?: boolean;
  /** Por que este registro cuenta como falla (regla de `lib/fallas`). */
  razon?: string | null;
};

export type Indicador = {
  clave: ClaveIndicador;
  nombre: string;
  definicion: string;
  formula: string;
  unidad: "h" | "%" | "MXN" | "ordenes";
  /** Nulo cuando no se puede calcular; `sinValor` dice por que. */
  valor: number | null;
  sinValor: string | null;
  alcance: {
    estadosOT: string;
    tiposTrabajo: string;
    tiposParo: string;
    fechaQueCuenta: string;
  };
  /** Cosas que quedaron fuera y conviene saber (ej. reparaciones sin horas). */
  notas: string[];
  /** Los registros que forman la cifra. Sumar `aporte` da el numerador. */
  detalle: Renglon[];
  /** Denominador, cuando el indicador es una proporcion o un promedio. */
  denominador: number | null;
  /** La formula con los numeros reales del periodo, para que se pueda seguir a mano. */
  calculo: string;
};

export type Indicadores = {
  organizationId: string;
  periodo: Periodo;
  actualizadoEl: Date;
  indicadores: Record<ClaveIndicador, Indicador>;
  /** Conteos de apoyo para pantallas e IA (mismo periodo y mismas reglas). */
  totales: {
    ordenesCreadas: number;
    ordenesCanceladas: number;
    ordenesTerminadas: number;
    backlog: number;
    backlogVencido: number;
    backlogHoras: number;
    activosEnServicio: number;
    activosParados: number;
    activosCriticos: number;
  };
  costos: { mano: number; refacciones: number; servicios: number; otros: number; total: number; enCurso: number };
  precisionEstimacion: number | null;
  porTipo: Record<string, number>;
  porPrioridad: Record<string, number>;
  porEstado: Record<string, number>;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const num = (n: number, decimales = 1) =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: decimales }).format(n);

/** La zona horaria de la empresa, o la de Mexico si no tiene. */
export async function zonaDeLaEmpresa(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone || ZONA_POR_OMISION;
}

/** El periodo de la empresa: ultimos `dias` dias completos en SU zona horaria. */
export async function periodoDeLaEmpresa(organizationId: string, dias: number, ahora = new Date()) {
  return periodoIndicadores(dias, await zonaDeLaEmpresa(organizationId), ahora);
}


/** Los eventos de paro del periodo: fuente unica del paro. */
export async function eventosDeParoDelPeriodo(
  organizationId: string,
  periodo: { desde: Date; hasta: Date },
) {
  return prisma.downtimeEvent.findMany({
    where: { asset: { organizationId }, startedAt: dentroDe(periodo) },
    select: {
      id: true, minutes: true, planned: true, startedAt: true, reason: true, workOrderId: true,
      asset: { select: { id: true, code: true, name: true } },
      workOrder: { select: { number: true } },
    },
    orderBy: { startedAt: "asc" },
  });
}

export async function calcularIndicadores(
  organizationId: string,
  periodo: Periodo,
  opciones: { ahora?: Date } = {},
): Promise<Indicadores> {
  const ahora = opciones.ahora ?? new Date();
  const zona = periodo.zonaHoraria;
  // El compromiso es un dia: se trae con un dia de holgura y se filtra por la
  // clave del dia, porque un compromiso a medianoche UTC cae la tarde anterior
  // en Mexico y quedaria fuera del limite por horas.
  const holgura = { gte: new Date(periodo.desde.getTime() - 36 * HORA), lt: new Date(periodo.hasta.getTime() + 36 * HORA) };
  const primerDia = claveDiaEnZona(periodo.desde, zona);
  const ultimoDia = claveDiaEnZona(new Date(periodo.hasta.getTime() - 1), zona);

  const seleccion = {
    id: true, number: true, title: true, status: true, maintenanceType: true, priority: true,
    createdAt: true, dueDate: true, startedAt: true, completedAt: true,
    actualHours: true, estimatedHours: true, failureCodeId: true,
    laborCost: true, partsCost: true, serviceCost: true, otherCost: true, totalCost: true,
    asset: { select: { code: true } },
    tasks: { select: { title: true, maintenanceType: true, failureCodeId: true, origenRequestId: true } },
  } as const;

  const [creadas, terminadas, iniciadas, programadas, abiertas, eventos, activos, deFalla] = await Promise.all([
    prisma.workOrder.findMany({ where: { organizationId, createdAt: dentroDe(periodo) }, select: seleccion }),
    prisma.workOrder.findMany({
      where: { organizationId, status: { in: [...ESTADOS_TERMINADOS] }, completedAt: dentroDe(periodo) },
      select: seleccion,
    }),
    prisma.workOrder.findMany({
      where: { organizationId, status: { not: "CANCELLED" }, startedAt: dentroDe(periodo) },
      select: seleccion,
    }),
    prisma.workOrder.findMany({
      where: {
        organizationId, status: { not: "CANCELLED" },
        maintenanceType: { in: [...TIPOS_PROGRAMADOS] }, dueDate: holgura,
      },
      select: seleccion,
    }),
    prisma.workOrder.findMany({ where: { organizationId, status: { in: [...ESTADOS_ABIERTOS] } }, select: seleccion }),
    eventosDeParoDelPeriodo(organizationId, periodo),
    prisma.asset.findMany({
      where: { organizationId, active: true, status: { not: "RETIRED" } },
      select: { id: true, status: true, criticality: true },
    }),
    solicitudesDeFalla(organizationId),
  ]);
  const falla = (o: { status: string; maintenanceType: string; failureCodeId: string | null; tasks: Array<{ title: string; maintenanceType: string | null; failureCodeId: string | null; origenRequestId: string | null }> }) =>
    clasificarFalla(o, deFalla);
  const ordenEsFalla = (o: Parameters<typeof falla>[0]) => falla(o).esFalla;

  type Orden = (typeof creadas)[number];
  const renglonOrden = (o: Orden, aporte: number, fecha: Date | null, aFavor?: boolean, conRazon = false): Renglon => ({
    id: o.id, tipo: "ORDEN", folio: o.number, workOrderId: o.id, titulo: o.title,
    activo: o.asset?.code ?? null, fecha, aporte, aFavor,
    ...(conRazon ? { razon: falla(o).razon } : {}),
  });

  const horasPeriodo = (periodo.hasta.getTime() - periodo.desde.getTime()) / HORA;
  const nActivos = activos.length;
  const horasCalendario = horasPeriodo * nActivos;

  // ── Paro ────────────────────────────────────────────────────────────────
  const renglonParo = (e: (typeof eventos)[number]): Renglon => ({
    id: e.id, tipo: "PARO", folio: e.workOrder?.number ?? null, workOrderId: e.workOrderId,
    titulo: e.reason ?? (e.planned ? "Paro planeado" : "Paro no planeado"),
    activo: e.asset.code, fecha: e.startedAt, aporte: e.minutes / 60,
  });
  const noPlaneados = eventos.filter((e) => !e.planned);
  const planeados = eventos.filter((e) => e.planned);
  const minutos = (xs: typeof eventos) => xs.reduce((s, e) => s + e.minutes, 0);
  const horasNoPlaneado = minutos(noPlaneados) / 60;

  const alcanceParo = {
    estadosOT: "No aplica: se cuentan los eventos de paro registrados al completar cada orden",
    tiposTrabajo: "Todos",
    fechaQueCuenta: "Inicio del paro dentro del periodo",
  };

  const paroTotal: Indicador = {
    clave: "paroTotal", calculo: `${num(minutos(eventos))} min ÷ 60 = ${num(minutos(eventos) / 60)} h en ${eventos.length} evento(s)`,
    nombre: "Paro acumulado",
    definicion: "Todas las horas que los equipos estuvieron detenidos por mantenimiento, planeado o no.",
    formula: "Σ minutos de los eventos de paro ÷ 60",
    unidad: "h", valor: r1(minutos(eventos) / 60), sinValor: null,
    alcance: { ...alcanceParo, tiposParo: "Planeado y no planeado" },
    notas: [], detalle: eventos.map(renglonParo), denominador: null,
  };
  const paroNoPlaneado: Indicador = {
    clave: "paroNoPlaneado", calculo: `${num(minutos(noPlaneados))} min ÷ 60 = ${num(horasNoPlaneado)} h en ${noPlaneados.length} evento(s)`,
    nombre: "Paro no planeado",
    definicion: "Horas perdidas por paros que no estaban programados: fallas y emergencias. Es la pérdida real de disponibilidad.",
    formula: "Σ minutos de los eventos de paro NO planeados ÷ 60",
    unidad: "h", valor: r1(horasNoPlaneado), sinValor: null,
    alcance: { ...alcanceParo, tiposParo: "Solo no planeado" },
    notas: [], detalle: noPlaneados.map(renglonParo), denominador: null,
  };
  const paroPlaneado: Indicador = {
    clave: "paroPlaneado", calculo: `${num(minutos(planeados))} min ÷ 60 = ${num(minutos(planeados) / 60)} h en ${planeados.length} evento(s)`,
    nombre: "Paro planeado",
    definicion: "Horas detenidas por mantenimiento programado. Se reporta aparte: no es una pérdida por falla.",
    formula: "Σ minutos de los eventos de paro planeados ÷ 60",
    unidad: "h", valor: r1(minutos(planeados) / 60), sinValor: null,
    alcance: { ...alcanceParo, tiposParo: "Solo planeado" },
    notas: [], detalle: planeados.map(renglonParo), denominador: null,
  };

  const disponibilidad: Indicador = {
    clave: "disponibilidad", calculo: nActivos ? `(${num(horasPeriodo, 0)} h × ${nActivos} = ${num(horasCalendario, 0)} h − ${num(horasNoPlaneado)} h) ÷ ${num(horasCalendario, 0)} h × 100 = ${num(((horasCalendario - horasNoPlaneado) / horasCalendario) * 100, 2)}%` : "Sin equipos en servicio",
    nombre: "Disponibilidad",
    definicion: "Proporción del tiempo calendario en que los equipos en servicio no estuvieron detenidos por paros no planeados.",
    formula: "(horas del periodo × equipos en servicio − horas de paro no planeado) ÷ (horas del periodo × equipos en servicio) × 100",
    unidad: "%",
    valor: nActivos ? Math.max(0, Math.min(100, ((horasCalendario - horasNoPlaneado) / horasCalendario) * 100)) : null,
    sinValor: nActivos ? null : "No hay equipos en servicio.",
    alcance: {
      estadosOT: alcanceParo.estadosOT, tiposTrabajo: "Todos",
      tiposParo: "Solo no planeado (el planeado no se cuenta como pérdida)",
      fechaQueCuenta: `Inicio del paro dentro del periodo; ${nActivos} equipo(s) en servicio hoy`,
    },
    notas: [], detalle: noPlaneados.map(renglonParo), denominador: r1(horasCalendario),
  };

  // ── Fallas, MTBF y MTTR ─────────────────────────────────────────────────
  const fallas = creadas.filter((o) => o.status !== "CANCELLED" && ordenEsFalla(o));
  const mtbf: Indicador = {
    clave: "mtbf", calculo: fallas.length && nActivos ? `(${num(horasCalendario, 0)} h − ${num(horasNoPlaneado)} h) ÷ ${fallas.length} falla(s) = ${num((horasCalendario - horasNoPlaneado) / fallas.length)} h` : `${fallas.length} falla(s): no hay entre qué dividir`,
    nombre: "MTBF (tiempo medio entre fallas)",
    definicion: "Horas de operación de los equipos en servicio por cada falla ocurrida en el periodo.",
    formula: "(horas del periodo × equipos en servicio − horas de paro no planeado) ÷ número de fallas",
    unidad: "h",
    valor: fallas.length && nActivos ? r1((horasCalendario - horasNoPlaneado) / fallas.length) : null,
    sinValor: !nActivos ? "No hay equipos en servicio." : fallas.length ? null : "Sin fallas en el periodo.",
    alcance: {
      estadosOT: "Todos menos Cancelada",
      tiposTrabajo: `Falla: ${REGLA_DE_FALLA}`,
      tiposParo: "Se resta solo el no planeado",
      fechaQueCuenta: "Fecha de creación de la orden (cuando se detectó la falla)",
    },
    notas: [], detalle: fallas.map((o) => renglonOrden(o, 1, o.createdAt, undefined, true)), denominador: fallas.length,
  };

  const reparaciones = terminadas.filter((o) => ordenEsFalla(o));
  const conHoras = reparaciones.filter((o) => o.actualHours > 0);
  const sinHoras = reparaciones.length - conHoras.length;
  const mttr: Indicador = {
    clave: "mttr", calculo: conHoras.length ? `${num(conHoras.reduce((s, o) => s + o.actualHours, 0))} h ÷ ${conHoras.length} reparación(es) = ${num(conHoras.reduce((s, o) => s + o.actualHours, 0) / conHoras.length)} h` : "Sin reparaciones con horas",
    nombre: "MTTR (tiempo medio de reparación)",
    definicion: "Horas-hombre registradas en promedio por cada reparación de falla terminada en el periodo.",
    formula: "Σ horas reales de las reparaciones terminadas ÷ número de reparaciones con horas",
    unidad: "h",
    valor: conHoras.length ? r1(conHoras.reduce((s, o) => s + o.actualHours, 0) / conHoras.length) : null,
    sinValor: conHoras.length ? null : reparaciones.length ? "Las reparaciones terminadas no tienen horas registradas." : "Sin reparaciones terminadas en el periodo.",
    alcance: {
      estadosOT: "Completada o Cerrada",
      tiposTrabajo: `Falla: ${REGLA_DE_FALLA}`,
      tiposParo: "No aplica",
      fechaQueCuenta: "Fecha de finalización operativa",
    },
    notas: sinHoras ? [`${sinHoras} reparación(es) terminada(s) sin horas registradas no entran al promedio.`] : [],
    detalle: conHoras.map((o) => renglonOrden(o, o.actualHours, o.completedAt, undefined, true)), denominador: conHoras.length,
  };

  // ── Cumplimiento preventivo ─────────────────────────────────────────────
  const conCompromisoEnPeriodo = programadas.filter((o) => {
    const dia = diaDelCompromiso(o.dueDate as Date, zona);
    return dia >= primerDia && dia <= ultimoDia;
  });
  let sinFechaFin = 0;
  const juzgables: Array<{ o: Orden; aFavor: boolean }> = [];
  for (const o of conCompromisoEnPeriodo) {
    const e = estadoDeVencimiento(o, { zona, ahora });
    if (e.clave === "CUMPLIDA_EN_FECHA") juzgables.push({ o, aFavor: true });
    else if (e.clave === "TERMINADA_TARDE" || e.clave === "VENCIDA") juzgables.push({ o, aFavor: false });
    else if (e.clave === "TERMINADA_SIN_FECHA") sinFechaFin += 1;
    // VENCE_HOY y POR_VENCER abiertas todavia estan en tiempo: no se juzgan.
  }
  const cumplidas = juzgables.filter((j) => j.aFavor).length;
  const cumplimientoPreventivo: Indicador = {
    clave: "cumplimientoPreventivo", calculo: juzgables.length ? `${cumplidas} en fecha ÷ ${juzgables.length} juzgadas × 100 = ${num((cumplidas / juzgables.length) * 100)}%` : "Sin órdenes que juzgar",
    nombre: "Cumplimiento preventivo",
    definicion: "De las órdenes programadas cuyo compromiso cayó en el periodo, cuántas se terminaron a más tardar el día comprometido.",
    formula: "órdenes terminadas en fecha ÷ (terminadas en fecha + terminadas tarde + abiertas ya vencidas) × 100",
    unidad: "%",
    valor: juzgables.length ? (cumplidas / juzgables.length) * 100 : null,
    sinValor: juzgables.length ? null : "No hubo órdenes programadas con compromiso vencido en el periodo.",
    alcance: {
      estadosOT: "Todos menos Cancelada; las abiertas que aún no vencen no se juzgan",
      tiposTrabajo: TIPOS_PROGRAMADOS.join(", "),
      tiposParo: "No aplica",
      fechaQueCuenta: "Día compromiso dentro del periodo; se cumple con la fecha de finalización operativa",
    },
    notas: sinFechaFin ? [`${sinFechaFin} orden(es) terminada(s) sin fecha de finalización no se pueden juzgar.`] : [],
    detalle: juzgables.map((j) => renglonOrden(j.o, j.aFavor ? 1 : 0, j.o.dueDate, j.aFavor)),
    denominador: juzgables.length,
  };

  // ── Tiempo de respuesta ─────────────────────────────────────────────────
  const atendidas = iniciadas.filter((o) => ordenEsFalla(o) && o.startedAt);
  const horasRespuesta = (o: Orden) => Math.max(0, ((o.startedAt as Date).getTime() - o.createdAt.getTime()) / HORA);
  const tiempoRespuesta: Indicador = {
    clave: "tiempoRespuesta", calculo: atendidas.length ? `${num(atendidas.reduce((s, o) => s + horasRespuesta(o), 0))} h ÷ ${atendidas.length} orden(es) = ${num(atendidas.reduce((s, o) => s + horasRespuesta(o), 0) / atendidas.length)} h` : "Sin órdenes de falla iniciadas",
    nombre: "Tiempo de respuesta",
    definicion: "Horas en promedio desde que se crea una orden de falla hasta que se inicia el trabajo.",
    formula: "Σ (inicio − creación) de las órdenes de falla iniciadas en el periodo ÷ número de órdenes",
    unidad: "h",
    valor: atendidas.length ? r1(atendidas.reduce((s, o) => s + horasRespuesta(o), 0) / atendidas.length) : null,
    sinValor: atendidas.length ? null : "Ninguna orden de falla se inició en el periodo.",
    alcance: {
      estadosOT: "Todos menos Cancelada",
      tiposTrabajo: `Falla: ${REGLA_DE_FALLA}`,
      tiposParo: "No aplica",
      fechaQueCuenta: "Fecha de inicio dentro del periodo",
    },
    notas: [], detalle: atendidas.map((o) => renglonOrden(o, horasRespuesta(o), o.startedAt, undefined, true)),
    denominador: atendidas.length,
  };

  // ── Trabajo planificado ─────────────────────────────────────────────────
  const deMantenimiento = terminadas.filter(
    (o) => !(TIPOS_FUERA_DE_MANTENIMIENTO as readonly string[]).includes(o.maintenanceType),
  );
  const planificadas = deMantenimiento.filter((o) => !ordenEsFalla(o));
  const trabajoPlanificado: Indicador = {
    clave: "trabajoPlanificado", calculo: deMantenimiento.length ? `${planificadas.length} planificadas ÷ ${deMantenimiento.length} terminadas × 100 = ${num((planificadas.length / deMantenimiento.length) * 100)}%` : "Sin órdenes terminadas",
    nombre: "Trabajo planificado",
    definicion: "Proporción de las órdenes terminadas en el periodo que no fueron fallas.",
    formula: "órdenes terminadas que no son falla ÷ órdenes terminadas × 100",
    unidad: "%",
    valor: deMantenimiento.length ? (planificadas.length / deMantenimiento.length) * 100 : null,
    sinValor: deMantenimiento.length ? null : "Sin órdenes terminadas en el periodo.",
    alcance: {
      estadosOT: "Completada o Cerrada",
      tiposTrabajo: `Todos menos ${TIPOS_FUERA_DE_MANTENIMIENTO.join(", ")}; falla = ${REGLA_DE_FALLA}`,
      tiposParo: "No aplica",
      fechaQueCuenta: "Fecha de finalización operativa",
    },
    notas: [],
    detalle: deMantenimiento.map((o) => renglonOrden(o, ordenEsFalla(o) ? 0 : 1, o.completedAt, !ordenEsFalla(o), ordenEsFalla(o))),
    denominador: deMantenimiento.length,
  };

  // ── Backlog (foto de hoy) ───────────────────────────────────────────────
  const vencidas = abiertas.filter((o) => estadoDeVencimiento(o, { zona, ahora }).clave === "VENCIDA");
  const backlog: Indicador = {
    clave: "backlog", calculo: `${abiertas.length} orden(es) abiertas, ${vencidas.length} vencida(s)`,
    nombre: "Backlog",
    definicion: "Órdenes abiertas hoy. No depende del periodo: es la carga pendiente en este momento.",
    formula: "número de órdenes en estado abierto",
    unidad: "ordenes", valor: abiertas.length, sinValor: null,
    alcance: {
      estadosOT: ESTADOS_ABIERTOS.join(", "),
      tiposTrabajo: "Todos",
      tiposParo: "No aplica",
      fechaQueCuenta: "Estado actual, sin periodo",
    },
    notas: vencidas.length ? [`${vencidas.length} vencida(s).`] : [],
    detalle: abiertas.map((o) => renglonOrden(o, 1, o.dueDate)), denominador: null,
  };

  // ── Costo ───────────────────────────────────────────────────────────────
  const suma = (xs: Orden[], k: "laborCost" | "partsCost" | "serviceCost" | "otherCost" | "totalCost") =>
    Math.round(xs.reduce((s, o) => s + o[k], 0));
  const costoMantenimiento: Indicador = {
    clave: "costoMantenimiento", calculo: `Σ de ${terminadas.length} orden(es) terminada(s) = $${num(terminadas.reduce((s, o) => s + o.totalCost, 0), 2)}`,
    nombre: "Costo de mantenimiento",
    definicion: "Lo que costaron las órdenes terminadas en el periodo: mano de obra, refacciones, servicios y otros.",
    formula: "Σ costo total de las órdenes terminadas en el periodo",
    unidad: "MXN", valor: suma(terminadas, "totalCost"), sinValor: null,
    alcance: {
      estadosOT: "Completada o Cerrada",
      tiposTrabajo: "Todos",
      tiposParo: "No aplica",
      fechaQueCuenta: "Fecha de finalización operativa",
    },
    notas: [],
    detalle: terminadas.map((o) => renglonOrden(o, o.totalCost, o.completedAt)), denominador: null,
  };
  const enCurso = Math.round(abiertas.reduce((s, o) => s + o.totalCost, 0));
  if (enCurso > 0) costoMantenimiento.notas.push(`Además hay $${enCurso.toLocaleString("es-MX")} cargados a órdenes todavía abiertas, que no entran hasta terminarse.`);

  // ── Apoyos para pantallas e IA ──────────────────────────────────────────
  const conAmbas = terminadas.filter((o) => o.estimatedHours > 0 && o.actualHours > 0);
  const precisionEstimacion = conAmbas.length
    ? (conAmbas.reduce((s, o) => s + Math.min(o.estimatedHours, o.actualHours) / Math.max(o.estimatedHours, o.actualHours), 0) / conAmbas.length) * 100
    : null;

  const contar = <T,>(xs: T[], k: (x: T) => string) =>
    xs.reduce<Record<string, number>>((acc, x) => ({ ...acc, [k(x)]: (acc[k(x)] ?? 0) + 1 }), {});
  const vivas = creadas.filter((o) => o.status !== "CANCELLED");

  return {
    organizationId,
    periodo,
    actualizadoEl: ahora,
    indicadores: {
      paroTotal, paroNoPlaneado, paroPlaneado, disponibilidad, mttr, mtbf,
      cumplimientoPreventivo, tiempoRespuesta, trabajoPlanificado, backlog, costoMantenimiento,
    },
    totales: {
      ordenesCreadas: vivas.length,
      ordenesCanceladas: creadas.length - vivas.length,
      ordenesTerminadas: terminadas.length,
      backlog: abiertas.length,
      backlogVencido: vencidas.length,
      backlogHoras: r1(abiertas.reduce((s, o) => s + (o.estimatedHours || 0), 0)),
      activosEnServicio: nActivos,
      activosParados: activos.filter((a) => a.status === "DOWN").length,
      activosCriticos: activos.filter((a) => a.criticality === "A").length,
    },
    costos: {
      mano: suma(terminadas, "laborCost"),
      refacciones: suma(terminadas, "partsCost"),
      servicios: suma(terminadas, "serviceCost"),
      otros: suma(terminadas, "otherCost"),
      total: suma(terminadas, "totalCost"),
      enCurso,
    },
    precisionEstimacion,
    porTipo: contar(vivas, (o) => o.maintenanceType),
    porPrioridad: contar(vivas, (o) => o.priority),
    porEstado: contar(creadas, (o) => o.status),
  };
}

/** Los indicadores del periodo y del inmediato anterior, con las mismas reglas. */
export async function indicadoresConComparacion(organizationId: string, dias: number, ahora = new Date()) {
  const periodo = await periodoDeLaEmpresa(organizationId, dias, ahora);
  const [actual, previo] = await Promise.all([
    calcularIndicadores(organizationId, periodo, { ahora }),
    calcularIndicadores(organizationId, periodoAnterior(periodo), { ahora }),
  ]);
  return { actual, previo };
}

/**
 * Tendencia mensual con las mismas reglas: meses de calendario en la zona de la
 * empresa, ordenes creadas por creacion, terminadas y costo por finalizacion,
 * paro desde los eventos de paro.
 */
export async function tendenciaMensual(organizationId: string, meses = 6, ahora = new Date()) {
  const zona = await zonaDeLaEmpresa(organizationId);
  const [anio, mes] = claveDiaEnZona(ahora, zona).split("-").map(Number);
  const { medianocheEnZona } = await import("./periodos");
  const cortes = Array.from({ length: meses + 1 }, (_, i) => medianocheEnZona(anio, mes - (meses - 1) + i, 1, zona));
  const desde = cortes[0];
  const hasta = cortes[meses];

  const [creadas, terminadas, eventos] = await Promise.all([
    prisma.workOrder.findMany({
      where: { organizationId, createdAt: { gte: desde, lt: hasta }, status: { not: "CANCELLED" } },
      select: { createdAt: true, maintenanceType: true },
    }),
    prisma.workOrder.findMany({
      where: { organizationId, status: { in: [...ESTADOS_TERMINADOS] }, completedAt: { gte: desde, lt: hasta } },
      select: { completedAt: true, totalCost: true },
    }),
    eventosDeParoDelPeriodo(organizationId, { desde, hasta }),
  ]);

  return cortes.slice(0, meses).map((inicio, i) => {
    const fin = cortes[i + 1];
    const en = (d: Date | null) => caeEn(d, { desde: inicio, hasta: fin });
    const c = creadas.filter((o) => en(o.createdAt));
    const t = terminadas.filter((o) => en(o.completedAt));
    const ev = eventos.filter((e) => en(e.startedAt));
    return {
      month: new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: zona }).format(inicio),
      creadas: c.length,
      completadas: t.length,
      preventivo: c.filter((o) => o.maintenanceType === "PREVENTIVE").length,
      correctivo: c.filter((o) => o.maintenanceType === "CORRECTIVE").length,
      predictivo: c.filter((o) => o.maintenanceType === "PREDICTIVE").length,
      costo: Math.round(t.reduce((s, o) => s + o.totalCost, 0)),
      paroHoras: r1(ev.reduce((s, e) => s + e.minutes, 0) / 60),
      paroNoPlaneadoHoras: r1(ev.filter((e) => !e.planned).reduce((s, e) => s + e.minutes, 0) / 60),
    };
  });
}

/**
 * Costo y paro por equipo en el periodo, con las mismas reglas: costo de las
 * ordenes terminadas, paro no planeado de los eventos de paro.
 */
export async function costoYParoPorActivo(organizationId: string, periodo: { desde: Date; hasta: Date }, limite = 8) {
  const [terminadas, eventos] = await Promise.all([
    prisma.workOrder.findMany({
      where: {
        organizationId, assetId: { not: null },
        status: { in: [...ESTADOS_TERMINADOS] }, completedAt: dentroDe(periodo),
      },
      select: { assetId: true, totalCost: true },
    }),
    eventosDeParoDelPeriodo(organizationId, periodo),
  ]);
  const porActivo = new Map<string, { costo: number; ordenes: number; minutosNoPlaneado: number }>();
  const de = (id: string) => porActivo.get(id) ?? { costo: 0, ordenes: 0, minutosNoPlaneado: 0 };
  for (const o of terminadas) {
    const x = de(o.assetId as string);
    x.costo += o.totalCost; x.ordenes += 1;
    porActivo.set(o.assetId as string, x);
  }
  for (const e of eventos) {
    if (e.planned) continue;
    const x = de(e.asset.id);
    x.minutosNoPlaneado += e.minutes;
    porActivo.set(e.asset.id, x);
  }
  const ids = [...porActivo.keys()];
  const activos = await prisma.asset.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true, name: true, code: true, criticality: true },
  });
  return ids
    .map((id) => {
      const a = activos.find((x) => x.id === id);
      const v = porActivo.get(id)!;
      return {
        assetId: id,
        name: a?.name ?? "Sin activo",
        code: a?.code ?? "—",
        criticality: a?.criticality ?? "C",
        costo: Math.round(v.costo),
        paroHoras: r1(v.minutosNoPlaneado / 60),
        ordenes: v.ordenes,
      };
    })
    .sort((x, y) => y.costo - x.costo || y.paroHoras - x.paroHoras)
    .slice(0, limite);
}
