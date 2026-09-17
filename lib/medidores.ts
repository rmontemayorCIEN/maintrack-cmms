/**
 * Lecturas de medidores: el UNICO lugar donde se validan, registran, corrigen,
 * anulan y recalculan.
 *
 * Por que existe. Una lectura mala no truena: se ve normal y descompone todo lo
 * que depende de ella. El caso real fue CMP-301, que paso de 18,420 a 20,500 h
 * en cuatro dias —2,080 horas en 96 horas de reloj—. El sistema lo acepto, el
 * promedio diario salto a 117 h/dia y los planes por uso se adelantaron meses.
 * Nada lo advirtio.
 *
 * Las reglas:
 *
 *  - Una lectura no puede ser menor que la anterior, salvo que se registre un
 *    REINICIO o una SUSTITUCION del medidor.
 *  - Un horometro no puede sumar mas horas que las que pasaron en el reloj.
 *    Eso no es atipico, es imposible: se bloquea.
 *  - Arriba del maximo diario configurado (o de 3 veces el promedio) la lectura
 *    es ATIPICA: se acepta solo con confirmacion y justificacion.
 *  - Nada se borra. Se corrige guardando el valor original, o se anula con
 *    motivo. Cada cambio queda en la bitacora.
 *  - Cada alta, correccion o anulacion recalcula desde el historial: los
 *    incrementos, el valor actual, el promedio diario y los planes por uso.
 *
 * El promedio diario ya no es una media movil incremental —que dependia del
 * orden en que llegaron las lecturas y no se podia rehacer al corregir una—
 * sino el uso real de los ultimos 90 dias dividido entre los dias que abarca.
 */
import { prisma } from "./db";
import { logAudit } from "./audit";
import { TIPOS_LECTURA, TIPOS_MEDIDOR } from "./constants";

const DIA = 86_400_000;
const HORA = 3_600_000;

export { TIPOS_MEDIDOR, TIPOS_LECTURA };
export type TipoMedidor = keyof typeof TIPOS_MEDIDOR;
export type TipoLectura = keyof typeof TIPOS_LECTURA;

/** Ventana del promedio diario. */
export const DIAS_PARA_PROMEDIO = 90;
/** Arriba de cuantas veces el promedio una lectura se considera atipica. */
export const VECES_EL_PROMEDIO = 3;
/** Holgura para relojes desfasados al capturar la fecha de la lectura. */
const HOLGURA_FUTURO_MS = 10 * 60_000;

export function tipoPorUnidad(unidad: string): TipoMedidor {
  const u = unidad.trim().toLowerCase();
  if (["h", "hr", "hrs", "horas"].includes(u)) return "HOROMETRO";
  if (["km", "mi", "kilometros", "millas"].includes(u)) return "ODOMETRO";
  if (["ciclos", "pzas", "piezas", "arranques", "golpes"].includes(u)) return "CICLOS";
  return "OTRO";
}

export function esTipoMedidor(v: unknown): v is TipoMedidor {
  return typeof v === "string" && v in TIPOS_MEDIDOR;
}

type MedidorParaValidar = {
  tipo: string;
  unit: string;
  maxIncrementoDiario: number | null;
  dailyAverage: number;
};

type PuntoDeLectura = { value: number; readingAt: Date; tipo: string };

export type Validacion = {
  nivel: "OK" | "ADVERTENCIA" | "ERROR";
  codigo:
    | "OK"
    | "FECHA_FUTURA"
    | "VALOR_NEGATIVO"
    | "MENOR_QUE_ANTERIOR"
    | "MAYOR_QUE_SIGUIENTE"
    | "HORAS_IMPOSIBLES"
    | "SUPERA_MAXIMO"
    | "SUPERA_PROMEDIO"
    | "FALTA_MOTIVO";
  mensaje: string;
  /** Lo que la persona necesita ver para decidir. */
  contexto: {
    anterior: number | null;
    anteriorEl: Date | null;
    nueva: number;
    incremento: number | null;
    horasTranscurridas: number | null;
    /** El uso por dia que implica ESTA lectura. */
    usoPorDia: number | null;
    promedioDiario: number;
    maximoPermitido: number | null;
    unidad: string;
  };
};

const fmt = (n: number, d = 1) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: d }).format(n);

function tiempo(horas: number) {
  return horas < 48 ? `${fmt(horas)} h` : `${fmt(horas / 24)} días`;
}

/**
 * Valida una lectura contra sus vecinas en el tiempo. Pura: no toca la base,
 * asi la usan igual el registro, la correccion y las pruebas.
 *
 * `anterior` y `siguiente` son las lecturas validas inmediatamente antes y
 * despues de la fecha de la nueva (una lectura puede capturarse con fecha
 * pasada).
 */
export function validarLectura(params: {
  medidor: MedidorParaValidar;
  anterior: PuntoDeLectura | null;
  siguiente: PuntoDeLectura | null;
  nueva: { value: number; readingAt: Date; tipo: TipoLectura; motivo?: string | null };
  ahora?: Date;
}): Validacion {
  const { medidor, anterior, siguiente, nueva } = params;
  const ahora = params.ahora ?? new Date();
  const unidad = medidor.unit;

  const incremento = anterior && nueva.tipo === "LECTURA" ? nueva.value - anterior.value : null;
  const horas = anterior ? (nueva.readingAt.getTime() - anterior.readingAt.getTime()) / HORA : null;
  const usoPorDia = incremento !== null && horas !== null && horas > 0 ? incremento / (horas / 24) : null;

  const maximoPermitido = (() => {
    if (!anterior || horas === null || nueva.tipo !== "LECTURA") return null;
    const porConfig = medidor.maxIncrementoDiario && medidor.maxIncrementoDiario > 0
      ? (horas / 24) * medidor.maxIncrementoDiario
      : null;
    if (medidor.tipo === "HOROMETRO") return porConfig !== null ? Math.min(porConfig, Math.max(0, horas)) : Math.max(0, horas);
    return porConfig;
  })();

  const contexto: Validacion["contexto"] = {
    anterior: anterior?.value ?? null,
    anteriorEl: anterior?.readingAt ?? null,
    nueva: nueva.value,
    incremento,
    horasTranscurridas: horas,
    usoPorDia,
    promedioDiario: medidor.dailyAverage,
    maximoPermitido,
    unidad,
  };
  const r = (nivel: Validacion["nivel"], codigo: Validacion["codigo"], mensaje: string): Validacion =>
    ({ nivel, codigo, mensaje, contexto });

  if (!Number.isFinite(nueva.value) || nueva.value < 0) {
    return r("ERROR", "VALOR_NEGATIVO", "La lectura no puede ser negativa.");
  }
  if (nueva.readingAt.getTime() > ahora.getTime() + HOLGURA_FUTURO_MS) {
    return r("ERROR", "FECHA_FUTURA", "La fecha de la lectura es posterior a este momento.");
  }

  // Reinicio o sustitucion: el valor puede bajar, pero hay que decir por que.
  if (nueva.tipo !== "LECTURA") {
    if (!nueva.motivo?.trim()) {
      return r("ERROR", "FALTA_MOTIVO", `Indique el motivo del ${nueva.tipo === "REINICIO" ? "reinicio" : "cambio"} del medidor.`);
    }
    return r("OK", "OK", "");
  }

  if (anterior && nueva.value < anterior.value) {
    return r(
      "ERROR",
      "MENOR_QUE_ANTERIOR",
      `La lectura (${fmt(nueva.value)} ${unidad}) es menor que la anterior (${fmt(anterior.value)} ${unidad}). ` +
        "Si el medidor se reinició o se cambió, regístrelo como reinicio o sustitución; si la anterior está mal, corríjala.",
    );
  }
  // Una lectura con fecha pasada tampoco puede quedar arriba de la que sigue,
  // salvo que la siguiente sea un reinicio (ahi empieza otra cuenta).
  if (siguiente && siguiente.tipo === "LECTURA" && nueva.value > siguiente.value) {
    return r(
      "ERROR",
      "MAYOR_QUE_SIGUIENTE",
      `La lectura (${fmt(nueva.value)} ${unidad}) es mayor que la registrada después (${fmt(siguiente.value)} ${unidad}).`,
    );
  }

  if (anterior && incremento !== null && horas !== null && medidor.tipo === "HOROMETRO" && incremento > Math.max(0, horas) + 1e-9) {
    return r(
      "ERROR",
      "HORAS_IMPOSIBLES",
      `Un horómetro no puede sumar ${fmt(incremento)} h en ${tiempo(Math.max(0, horas))} de reloj. ` +
        `Anterior ${fmt(anterior.value)} h, nueva ${fmt(nueva.value)} h. ` +
        "Revise la lectura, corrija la anterior o registre la sustitución del medidor.",
    );
  }

  if (
    siguiente && siguiente.tipo === "LECTURA" && medidor.tipo === "HOROMETRO" &&
    siguiente.value - nueva.value > (siguiente.readingAt.getTime() - nueva.readingAt.getTime()) / HORA + 1e-9
  ) {
    return r(
      "ERROR",
      "HORAS_IMPOSIBLES",
      `Con esta lectura, la siguiente (${fmt(siguiente.value)} h) sumaría más horas que las transcurridas en el reloj.`,
    );
  }

  const detalle = () =>
    `Anterior ${fmt(anterior!.value)} ${unidad}, nueva ${fmt(nueva.value)} ${unidad}: +${fmt(incremento!)} ${unidad} ` +
    `en ${tiempo(Math.max(0, horas!))} (${usoPorDia === null ? "—" : fmt(usoPorDia)} ${unidad}/día; ` +
    `promedio actual ${fmt(medidor.dailyAverage)} ${unidad}/día).`;

  if (anterior && incremento !== null && maximoPermitido !== null && incremento > maximoPermitido + 1e-9) {
    return r("ADVERTENCIA", "SUPERA_MAXIMO", `La lectura supera el uso máximo configurado (${fmt(medidor.maxIncrementoDiario ?? 24)} ${unidad}/día). ${detalle()}`);
  }
  if (
    anterior && incremento !== null && usoPorDia !== null && horas !== null && horas >= 24 &&
    medidor.dailyAverage > 0 && usoPorDia > medidor.dailyAverage * VECES_EL_PROMEDIO
  ) {
    return r("ADVERTENCIA", "SUPERA_PROMEDIO", `La lectura implica más de ${VECES_EL_PROMEDIO} veces el uso promedio. ${detalle()}`);
  }
  return r("OK", "OK", "");
}

/** Error de validacion con el detalle, para que la ruta responda 422 con contexto. */
export class LecturaRechazada extends Error {
  constructor(public validacion: Validacion) {
    super(validacion.mensaje);
  }
}

async function vecinas(meterId: string, readingAt: Date, excluirId?: string) {
  const base = { meterId, estado: { not: "ANULADA" }, ...(excluirId ? { id: { not: excluirId } } : {}) };
  const [anterior, siguiente] = await Promise.all([
    prisma.meterReading.findFirst({
      where: { ...base, readingAt: { lte: readingAt } },
      orderBy: [{ readingAt: "desc" }, { id: "desc" }],
      select: { value: true, readingAt: true, tipo: true },
    }),
    prisma.meterReading.findFirst({
      where: { ...base, readingAt: { gt: readingAt } },
      orderBy: [{ readingAt: "asc" }, { id: "asc" }],
      select: { value: true, readingAt: true, tipo: true },
    }),
  ]);
  return { anterior, siguiente };
}

export type ResultadoRegistro =
  | { ok: true; lecturaId: string; validacion: Validacion; recalculo: Recalculo }
  | { ok: false; requiereConfirmacion: true; validacion: Validacion };

/**
 * Registra una lectura, un reinicio o una sustitucion.
 *
 * Una ADVERTENCIA no se guarda hasta que llega `confirmar: true` con
 * `justificacion`: la primera llamada devuelve el detalle para mostrarlo.
 */
export async function registrarLectura(params: {
  organizationId: string;
  meterId: string;
  userId: string | null;
  value: number;
  readingAt?: Date;
  tipo?: TipoLectura;
  note?: string | null;
  source?: string;
  confirmar?: boolean;
  justificacion?: string | null;
  ahora?: Date;
}): Promise<ResultadoRegistro> {
  const medidor = await prisma.meter.findFirst({
    where: { id: params.meterId, organizationId: params.organizationId },
  });
  if (!medidor) throw new Error("Medidor no encontrado");

  const tipo = params.tipo ?? "LECTURA";
  const readingAt = params.readingAt ?? params.ahora ?? new Date();
  const { anterior, siguiente } = await vecinas(medidor.id, readingAt);

  // Un medidor sin lecturas arranca en su valor inicial: la primera lectura se
  // valida contra el en la fecha de alta.
  const referencia = anterior ?? (medidor.currentValue > 0 || medidor.lastReadingAt
    ? { value: medidor.currentValue, readingAt: medidor.lastReadingAt ?? medidor.createdAt, tipo: "LECTURA" }
    : null);

  const validacion = validarLectura({
    medidor,
    anterior: referencia,
    siguiente,
    nueva: { value: params.value, readingAt, tipo, motivo: params.justificacion ?? params.note },
    ahora: params.ahora,
  });
  if (validacion.nivel === "ERROR") throw new LecturaRechazada(validacion);
  if (validacion.nivel === "ADVERTENCIA" && (!params.confirmar || !params.justificacion?.trim())) {
    return { ok: false, requiereConfirmacion: true, validacion };
  }

  // Un reinicio o sustitucion recorre los planes por uso: lo que les faltaba
  // contra el medidor viejo es lo que les falta contra el nuevo.
  const valorAntes = anterior?.value ?? medidor.currentValue;

  const lectura = await prisma.meterReading.create({
    data: {
      organizationId: params.organizationId,
      meterId: medidor.id,
      userId: params.userId,
      value: params.value,
      delta: 0,
      readingAt,
      source: params.source ?? "MANUAL",
      note: params.note ?? null,
      tipo,
      atipica: validacion.nivel === "ADVERTENCIA",
      justificacion: params.justificacion?.trim() || null,
    },
  });

  if (tipo !== "LECTURA") {
    const asignaciones = await prisma.planAsset.findMany({
      where: { organizationId: params.organizationId, meterId: medidor.id, nextDueMeter: { not: null } },
      select: { id: true, nextDueMeter: true },
    });
    for (const a of asignaciones) {
      const faltaba = (a.nextDueMeter as number) - valorAntes;
      await prisma.planAsset.update({ where: { id: a.id }, data: { nextDueMeter: params.value + faltaba } });
    }
  }

  if (tipo !== "LECTURA" || validacion.nivel === "ADVERTENCIA") {
    await logAudit({
      organizationId: params.organizationId,
      userId: params.userId,
      entity: "MeterReading",
      entityId: lectura.id,
      action: tipo === "LECTURA" ? "LECTURA_ATIPICA" : tipo,
      summary:
        tipo === "LECTURA"
          ? `${medidor.name}: lectura atípica ${params.value} ${medidor.unit} aceptada. ${validacion.mensaje}`
          : `${medidor.name}: ${TIPOS_LECTURA[tipo].toLowerCase()} de ${valorAntes} a ${params.value} ${medidor.unit}`,
      changes: { validacion: validacion.contexto, justificacion: params.justificacion ?? null, valorAntes },
    });
  }

  const recalculo = await recalcularMedidor(params.organizationId, medidor.id, params.ahora);
  return { ok: true, lecturaId: lectura.id, validacion, recalculo };
}

/** Busca la lectura dentro de la empresa; nunca por id suelto. */
async function lecturaDeLaEmpresa(organizationId: string, readingId: string) {
  const lectura = await prisma.meterReading.findFirst({
    where: { id: readingId, organizationId },
    include: { meter: true },
  });
  if (!lectura) throw new Error("Lectura no encontrada");
  if (lectura.estado === "ANULADA") throw new Error("La lectura está anulada");
  if (lectura.tipo !== "LECTURA") {
    // Deshacer un reinicio obligaria a recorrer otra vez los planes por uso a
    // mano. Se corrige registrando uno nuevo, que deja el rastro completo.
    throw new Error("Un reinicio o sustitución no se corrige ni se anula: registre uno nuevo con el valor correcto.");
  }
  return lectura;
}

/**
 * Corrige el valor (y opcionalmente la fecha) de una lectura. Conserva el
 * original la primera vez; cada correccion posterior queda en la bitacora.
 */
export async function corregirLectura(params: {
  organizationId: string;
  readingId: string;
  userId: string;
  value: number;
  readingAt?: Date;
  motivo: string;
  confirmar?: boolean;
  ahora?: Date;
}): Promise<ResultadoRegistro> {
  if (!params.motivo?.trim()) throw new Error("Indique el motivo de la corrección");
  const lectura = await lecturaDeLaEmpresa(params.organizationId, params.readingId);
  const readingAt = params.readingAt ?? lectura.readingAt;
  const { anterior, siguiente } = await vecinas(lectura.meterId, readingAt, lectura.id);

  const validacion = validarLectura({
    medidor: lectura.meter,
    anterior,
    siguiente,
    nueva: { value: params.value, readingAt, tipo: "LECTURA" },
    ahora: params.ahora,
  });
  if (validacion.nivel === "ERROR") throw new LecturaRechazada(validacion);
  if (validacion.nivel === "ADVERTENCIA" && !params.confirmar) {
    return { ok: false, requiereConfirmacion: true, validacion };
  }

  const ahora = params.ahora ?? new Date();
  await prisma.meterReading.update({
    where: { id: lectura.id },
    data: {
      value: params.value,
      readingAt,
      estado: "CORREGIDA",
      valorOriginal: lectura.valorOriginal ?? lectura.value,
      fechaOriginal: lectura.fechaOriginal ?? lectura.readingAt,
      correccionPorId: params.userId,
      correccionEl: ahora,
      correccionMotivo: params.motivo.trim(),
      atipica: validacion.nivel === "ADVERTENCIA",
      justificacion: validacion.nivel === "ADVERTENCIA" ? params.motivo.trim() : lectura.justificacion,
    },
  });
  await logAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    entity: "MeterReading",
    entityId: lectura.id,
    action: "CORREGIDA",
    summary: `${lectura.meter.name}: ${lectura.value} → ${params.value} ${lectura.meter.unit}. ${params.motivo.trim()}`,
    changes: {
      antes: { value: lectura.value, readingAt: lectura.readingAt.toISOString() },
      despues: { value: params.value, readingAt: readingAt.toISOString() },
      motivo: params.motivo.trim(),
    },
  });

  const recalculo = await recalcularMedidor(params.organizationId, lectura.meterId, params.ahora);
  return { ok: true, lecturaId: lectura.id, validacion, recalculo };
}

/** Anula una lectura (sin borrarla) y recalcula sin ella. */
export async function anularLectura(params: {
  organizationId: string;
  readingId: string;
  userId: string;
  motivo: string;
  ahora?: Date;
}) {
  if (!params.motivo?.trim()) throw new Error("Indique el motivo de la anulación");
  const lectura = await lecturaDeLaEmpresa(params.organizationId, params.readingId);
  await prisma.meterReading.update({
    where: { id: lectura.id },
    data: {
      estado: "ANULADA",
      correccionPorId: params.userId,
      correccionEl: params.ahora ?? new Date(),
      correccionMotivo: params.motivo.trim(),
    },
  });
  await logAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    entity: "MeterReading",
    entityId: lectura.id,
    action: "ANULADA",
    summary: `${lectura.meter.name}: lectura ${lectura.value} ${lectura.meter.unit} anulada. ${params.motivo.trim()}`,
    changes: { value: lectura.value, readingAt: lectura.readingAt.toISOString(), motivo: params.motivo.trim() },
  });
  return recalcularMedidor(params.organizationId, lectura.meterId, params.ahora);
}

export type Recalculo = {
  currentValue: number;
  dailyAverage: number;
  lastReadingAt: Date | null;
  lecturasValidas: number;
  planesRecalculados: number;
};

/**
 * El promedio diario desde el historial: uso de los ultimos 90 dias dentro del
 * tramo actual del medidor (despues del ultimo reinicio o sustitucion),
 * dividido entre los dias que abarcan esas lecturas. Nulo si abarcan menos de
 * un dia o hay una sola lectura: no hay de donde sacarlo.
 */
export function promedioDiario(
  lecturas: Array<{ value: number; readingAt: Date; tipo: string }>,
  tipoMedidor: string,
): number | null {
  if (!lecturas.length) return null;
  const orden = [...lecturas].sort((a, b) => a.readingAt.getTime() - b.readingAt.getTime());
  let inicioTramo = 0;
  orden.forEach((l, i) => { if (l.tipo !== "LECTURA") inicioTramo = i; });
  const tramo = orden.slice(inicioTramo);
  const ultima = tramo.at(-1)!;
  const corte = ultima.readingAt.getTime() - DIAS_PARA_PROMEDIO * DIA;
  // La base es la ultima lectura en o antes del corte; si no hay, la primera del tramo.
  let base = tramo[0];
  for (const l of tramo) if (l.readingAt.getTime() <= corte) base = l;
  const dias = (ultima.readingAt.getTime() - base.readingAt.getTime()) / DIA;
  if (dias < 1) return null;
  const uso = Math.max(0, ultima.value - base.value) / dias;
  return tipoMedidor === "HOROMETRO" ? Math.min(24, uso) : uso;
}

/**
 * Rehace todo lo que depende de las lecturas de un medidor: incrementos, valor
 * actual, promedio diario, y la fecha estimada de los planes por uso.
 */
export async function recalcularMedidor(organizationId: string, meterId: string, ahora = new Date()): Promise<Recalculo> {
  const medidor = await prisma.meter.findFirst({ where: { id: meterId, organizationId } });
  if (!medidor) throw new Error("Medidor no encontrado");

  const lecturas = await prisma.meterReading.findMany({
    where: { meterId, organizationId, estado: { not: "ANULADA" } },
    orderBy: [{ readingAt: "asc" }, { id: "asc" }],
    select: { id: true, value: true, delta: true, readingAt: true, tipo: true },
  });

  // Incrementos: contra la lectura valida anterior del mismo tramo.
  let previa: (typeof lecturas)[number] | null = null;
  for (const l of lecturas) {
    const delta = l.tipo !== "LECTURA" || !previa ? 0 : l.value - previa.value;
    if (Math.abs(delta - l.delta) > 1e-9) {
      await prisma.meterReading.update({ where: { id: l.id }, data: { delta } });
    }
    previa = l;
  }

  const ultima = lecturas.at(-1) ?? null;
  const promedio = promedioDiario(lecturas, medidor.tipo);
  const data = {
    currentValue: ultima ? ultima.value : medidor.currentValue,
    lastReadingAt: ultima ? ultima.readingAt : null,
    dailyAverage: promedio ?? 0,
  };
  await prisma.meter.update({ where: { id: meterId }, data });

  // Planes por uso: la fecha estimada con el promedio nuevo. La meta en
  // unidades (`nextDueMeter`) no cambia al corregir: es lo que se prometio.
  const asignaciones = await prisma.planAsset.findMany({
    where: { organizationId, meterId, active: true, nextDueMeter: { not: null }, plan: { triggerType: "METER" } },
    select: { id: true, nextDueMeter: true },
  });
  for (const a of asignaciones) {
    await prisma.planAsset.update({
      where: { id: a.id },
      data: { nextDueDate: fechaEstimadaPorUso(a.nextDueMeter as number, data.currentValue, data.dailyAverage, ahora) },
    });
  }

  return {
    currentValue: data.currentValue,
    dailyAverage: data.dailyAverage,
    lastReadingAt: data.lastReadingAt,
    lecturasValidas: lecturas.length,
    planesRecalculados: asignaciones.length,
  };
}

/**
 * Cuando se estima que se alcanza la meta de uso. Misma regla que el
 * programador (`resolveDueDate`): vencido es hoy; sin promedio se supone una
 * unidad por dia.
 */
export function fechaEstimadaPorUso(meta: number, actual: number, promedio: number, ahora = new Date()): Date {
  const falta = meta - actual;
  if (falta <= 0) return ahora;
  const ritmo = promedio > 0 ? promedio : 1;
  return new Date(ahora.getTime() + Math.ceil(falta / ritmo) * DIA);
}
