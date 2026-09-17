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
 *    Eso no es atipico, es FISICAMENTE IMPOSIBLE: se bloquea y ninguna
 *    justificacion lo desbloquea.
 *  - Arriba del maximo diario configurado (o de 3 veces el promedio) la lectura
 *    es ATIPICA: se acepta solo con confirmacion y justificacion.
 *  - Nada se borra. Se corrige guardando el valor original, o se anula con
 *    motivo. Tambien los reinicios y sustituciones, siempre que la historia
 *    que queda siga siendo continua. Cada cambio queda en la bitacora.
 *  - Cada alta, correccion o anulacion recalcula desde el historial, en una
 *    transaccion: incrementos, valor actual, promedio diario, vigencia y la
 *    fecha estimada de los planes por uso.
 *
 * El promedio diario no es una media movil incremental —dependia del orden en
 * que llegaron las lecturas y no se podia rehacer al corregir una— sino el uso
 * real de los ultimos 90 dias dividido entre los dias que abarca.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { logAudit } from "./audit";
import { TIPOS_LECTURA, TIPOS_MEDIDOR } from "./constants";
import { claveDiaEnZona, medianocheEnZona } from "./periodos";

const DIA = 86_400_000;
const HORA = 3_600_000;

export { TIPOS_MEDIDOR, TIPOS_LECTURA };
export type TipoMedidor = keyof typeof TIPOS_MEDIDOR;
export type TipoLectura = keyof typeof TIPOS_LECTURA;

/** Ventana del promedio diario. */
export const DIAS_PARA_PROMEDIO = 90;
/** Arriba de cuantas veces el promedio una lectura se considera atipica. */
export const VECES_EL_PROMEDIO = 3;
/** Un plan por uso se reporta «por vencer» si le faltan menos de estos dias. */
export const DIAS_POR_VENCER = 7;
/** Holgura para relojes desfasados al capturar la fecha de la lectura. */
const HOLGURA_FUTURO_MS = 10 * 60_000;

type Cliente = Prisma.TransactionClient | typeof prisma;

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
    | "FALTA_MOTIVO"
    | "ROMPE_CONTINUIDAD";
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
    /** Lo maximo aceptable: horas de reloj en un horometro, o el configurado. */
    maximoPermitido: number | null;
    unidad: string;
    /** Que puede hacer la persona en vez de insistir. */
    alternativas: string[];
  };
};

const fmt = (n: number, d = 1) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: d }).format(n);

function tiempo(horas: number) {
  return horas < 48 ? `${fmt(horas)} h` : `${fmt(horas / 24)} días (${fmt(horas, 0)} h)`;
}

const ALTERNATIVAS_IMPOSIBLE = [
  "Corregir la lectura: revisar el valor capturado o corregir la lectura anterior si es la que está mal.",
  "Registrar una sustitución, si se instaló otro medidor.",
  "Registrar un reinicio, si el medidor se puso en cero o se reprogramó.",
];

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
  const porConfig = horas !== null && medidor.maxIncrementoDiario && medidor.maxIncrementoDiario > 0
    ? (Math.max(0, horas) / 24) * medidor.maxIncrementoDiario
    : null;
  const fisico = medidor.tipo === "HOROMETRO" && horas !== null ? Math.max(0, horas) : null;

  const contexto: Validacion["contexto"] = {
    anterior: anterior?.value ?? null,
    anteriorEl: anterior?.readingAt ?? null,
    nueva: nueva.value,
    incremento,
    horasTranscurridas: horas,
    usoPorDia,
    promedioDiario: medidor.dailyAverage,
    maximoPermitido: nueva.tipo !== "LECTURA" ? null : fisico !== null && porConfig !== null ? Math.min(fisico, porConfig) : fisico ?? porConfig,
    unidad,
    alternativas: [],
  };
  const r = (nivel: Validacion["nivel"], codigo: Validacion["codigo"], mensaje: string, extra: Partial<Validacion["contexto"]> = {}): Validacion =>
    ({ nivel, codigo, mensaje, contexto: { ...contexto, ...extra } });

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
    // La lectura que sigue se mide contra este nuevo punto de partida.
    if (siguiente && siguiente.tipo === "LECTURA" && siguiente.value < nueva.value) {
      return r("ERROR", "ROMPE_CONTINUIDAD",
        `La lectura registrada después (${fmt(siguiente.value)} ${unidad}) quedaría menor que este punto de partida (${fmt(nueva.value)} ${unidad}).`);
    }
    return r("OK", "OK", "");
  }

  if (anterior && nueva.value < anterior.value) {
    return r(
      "ERROR",
      "MENOR_QUE_ANTERIOR",
      `La lectura (${fmt(nueva.value)} ${unidad}) es menor que la anterior (${fmt(anterior.value)} ${unidad}). ` +
        "Si el medidor se reinició o se cambió, regístrelo como reinicio o sustitución; si la anterior está mal, corríjala.",
      { alternativas: ALTERNATIVAS_IMPOSIBLE },
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

  if (anterior && incremento !== null && fisico !== null && incremento > fisico + 1e-9) {
    return r(
      "ERROR",
      "HORAS_IMPOSIBLES",
      `Lectura físicamente imposible: un horómetro no puede sumar más horas que las transcurridas en el reloj. ` +
        `Lectura anterior: ${fmt(anterior.value)} h. Nueva lectura: ${fmt(nueva.value)} h. ` +
        `Incremento pretendido: ${fmt(incremento)} h. Horas naturales transcurridas: ${tiempo(fisico)}. ` +
        `Máximo permitido: ${fmt(fisico)} h. No se puede aceptar con justificación. ` +
        "Alternativas: corregir la lectura, registrar una sustitución o registrar un reinicio del medidor.",
      { maximoPermitido: fisico, alternativas: ALTERNATIVAS_IMPOSIBLE },
    );
  }

  if (
    siguiente && siguiente.tipo === "LECTURA" && medidor.tipo === "HOROMETRO" &&
    siguiente.value - nueva.value > (siguiente.readingAt.getTime() - nueva.readingAt.getTime()) / HORA + 1e-9
  ) {
    const h = (siguiente.readingAt.getTime() - nueva.readingAt.getTime()) / HORA;
    return r(
      "ERROR",
      "HORAS_IMPOSIBLES",
      `Lectura físicamente imposible: con ${fmt(nueva.value)} h, la lectura siguiente (${fmt(siguiente.value)} h) ` +
        `sumaría ${fmt(siguiente.value - nueva.value)} h en ${tiempo(Math.max(0, h))} de reloj. Máximo permitido: ${fmt(Math.max(0, h))} h. ` +
        "Alternativas: corregir la lectura, registrar una sustitución o registrar un reinicio del medidor.",
      { alternativas: ALTERNATIVAS_IMPOSIBLE },
    );
  }

  const detalle = () =>
    `Anterior ${fmt(anterior!.value)} ${unidad}, nueva ${fmt(nueva.value)} ${unidad}: +${fmt(incremento!)} ${unidad} ` +
    `en ${tiempo(Math.max(0, horas!))} (${usoPorDia === null ? "—" : fmt(usoPorDia)} ${unidad}/día; ` +
    `promedio actual ${fmt(medidor.dailyAverage)} ${unidad}/día).`;

  if (anterior && incremento !== null && porConfig !== null && incremento > porConfig + 1e-9) {
    return r("ADVERTENCIA", "SUPERA_MAXIMO",
      `La lectura supera el uso máximo configurado (${fmt(medidor.maxIncrementoDiario as number)} ${unidad}/día). ${detalle()}`,
      { maximoPermitido: porConfig });
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

type LecturaDeCadena = { id: string; value: number; readingAt: Date; tipo: string; atipica?: boolean };

/**
 * Lo que esta mal en una historia de lecturas vigentes, lectura por lectura.
 * Sirve para el ensayo de recalculo y para saber si anular o corregir un
 * reinicio romperia la continuidad.
 */
export function problemasDeCadena(
  lecturas: LecturaDeCadena[],
  medidor: { tipo: string; unit: string; maxIncrementoDiario: number | null },
): Map<string, string> {
  const orden = [...lecturas].sort((a, b) => a.readingAt.getTime() - b.readingAt.getTime() || a.id.localeCompare(b.id));
  const problemas = new Map<string, string>();
  for (let i = 1; i < orden.length; i++) {
    const a = orden[i - 1];
    const b = orden[i];
    if (b.tipo !== "LECTURA") continue;
    const horas = (b.readingAt.getTime() - a.readingAt.getTime()) / HORA;
    const inc = b.value - a.value;
    if (inc < 0) {
      problemas.set(b.id, `${fmt(b.value)} ${medidor.unit} es menor que la anterior (${fmt(a.value)} ${medidor.unit})`);
    } else if (medidor.tipo === "HOROMETRO" && inc > Math.max(0, horas) + 1e-9) {
      problemas.set(b.id, `+${fmt(inc)} h en ${tiempo(Math.max(0, horas))} de reloj: físicamente imposible`);
    } else if (!b.atipica && medidor.maxIncrementoDiario && medidor.maxIncrementoDiario > 0 && inc > (Math.max(0, horas) / 24) * medidor.maxIncrementoDiario + 1e-9) {
      problemas.set(b.id, `+${fmt(inc)} ${medidor.unit} supera el máximo diario sin justificación`);
    }
  }
  return problemas;
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

/** El punto de partida cuando no hay lectura anterior: el valor inicial formal. */
function referenciaInicial(medidor: { currentValue: number; lastReadingAt: Date | null; createdAt: Date; valorInicial: number | null; valorInicialEl: Date | null; lecturaVigente: boolean }) {
  if (medidor.valorInicial !== null) {
    return { value: medidor.valorInicial, readingAt: medidor.valorInicialEl ?? medidor.createdAt, tipo: "LECTURA" };
  }
  // Medidores dados de alta antes del valor inicial formal: su valor de alta.
  if (medidor.lecturaVigente && (medidor.currentValue > 0 || medidor.lastReadingAt)) {
    return { value: medidor.currentValue, readingAt: medidor.lastReadingAt ?? medidor.createdAt, tipo: "LECTURA" };
  }
  return null;
}

/** Recorre la meta de los planes por uso de un medidor, en la misma transaccion. */
async function recorrerMetas(tx: Cliente, organizationId: string, meterId: string, desplazamiento: number) {
  if (Math.abs(desplazamiento) < 1e-9) return 0;
  const asignaciones = await tx.planAsset.findMany({
    where: { organizationId, meterId, nextDueMeter: { not: null } },
    select: { id: true, nextDueMeter: true },
  });
  for (const a of asignaciones) {
    await tx.planAsset.update({ where: { id: a.id }, data: { nextDueMeter: (a.nextDueMeter as number) + desplazamiento } });
  }
  return asignaciones.length;
}

export type ResultadoRegistro =
  | { ok: true; lecturaId: string; validacion: Validacion; recalculo: Recalculo }
  | { ok: false; requiereConfirmacion: true; validacion: Validacion };

/**
 * Registra una lectura, un reinicio o una sustitucion.
 *
 * Una ADVERTENCIA no se guarda hasta que llega `confirmar: true` con
 * `justificacion`: la primera llamada devuelve el detalle para mostrarlo. Un
 * ERROR nunca se guarda, venga con lo que venga.
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
  const referencia = anterior ?? referenciaInicial(medidor);

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
  // contra el medidor viejo es lo que les falta contra el nuevo. El valor de
  // antes se guarda en el evento para poder deshacerlo.
  const valorAntes = referencia?.value ?? 0;

  const { lecturaId, recalculo } = await prisma.$transaction(async (tx) => {
    const lectura = await tx.meterReading.create({
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
        valorAnterior: tipo === "LECTURA" ? null : valorAntes,
        atipica: validacion.nivel === "ADVERTENCIA",
        justificacion: params.justificacion?.trim() || null,
      },
    });
    if (tipo !== "LECTURA") await recorrerMetas(tx, params.organizationId, medidor.id, params.value - valorAntes);
    return { lecturaId: lectura.id, recalculo: await recalcularEn(tx, params.organizationId, medidor.id, params.ahora) };
  });

  if (tipo !== "LECTURA" || validacion.nivel === "ADVERTENCIA") {
    await logAudit({
      organizationId: params.organizationId,
      userId: params.userId,
      entity: "MeterReading",
      entityId: lecturaId,
      action: tipo === "LECTURA" ? "LECTURA_ATIPICA" : tipo,
      summary:
        tipo === "LECTURA"
          ? `${medidor.name}: lectura atípica ${params.value} ${medidor.unit} aceptada. ${validacion.mensaje}`
          : `${medidor.name}: ${TIPOS_LECTURA[tipo].toLowerCase()} de ${valorAntes} a ${params.value} ${medidor.unit}`,
      changes: { validacion: validacion.contexto, justificacion: params.justificacion ?? null, valorAntes },
    });
  }

  return { ok: true, lecturaId, validacion, recalculo };
}

/** Busca la lectura dentro de la empresa; nunca por id suelto. */
async function lecturaDeLaEmpresa(organizationId: string, readingId: string) {
  const lectura = await prisma.meterReading.findFirst({
    where: { id: readingId, organizationId },
    include: { meter: true },
  });
  if (!lectura) throw new Error("Lectura no encontrada");
  if (lectura.estado === "ANULADA") throw new Error("La lectura está anulada");
  return lectura;
}

/** Las lecturas vigentes de un medidor, para revisar continuidad. */
function cadenaVigente(meterId: string, organizationId: string) {
  return prisma.meterReading.findMany({
    where: { meterId, organizationId, estado: { not: "ANULADA" } },
    select: { id: true, value: true, readingAt: true, tipo: true, atipica: true },
  });
}

/**
 * Si quitar o cambiar un reinicio rompe la historia: lecturas que hoy estan
 * bien y dejarian de estarlo. Las que ya estaban mal no cuentan —no es culpa
 * de esta correccion—.
 */
async function nuevasRupturas(
  meter: { id: string; organizationId: string; tipo: string; unit: string; maxIncrementoDiario: number | null },
  cambiar: (cadena: LecturaDeCadena[]) => LecturaDeCadena[],
) {
  const cadena = await cadenaVigente(meter.id, meter.organizationId);
  const antes = problemasDeCadena(cadena, meter);
  const despues = problemasDeCadena(cambiar(cadena), meter);
  const lecturas = new Map(cadena.map((l) => [l.id, l]));
  return [...despues.entries()]
    .filter(([id]) => !antes.has(id))
    .map(([id, motivo]) => `${lecturas.get(id)?.readingAt.toISOString().slice(0, 10) ?? ""}: ${motivo}`);
}

/**
 * Corrige una lectura conservando su original. Tambien un reinicio o
 * sustitucion: su valor, su tipo o su fecha, recorriendo los planes por la
 * diferencia y sin romper la continuidad de lo que se registro despues.
 */
export async function corregirLectura(params: {
  organizationId: string;
  readingId: string;
  userId: string;
  value: number;
  readingAt?: Date;
  /** Solo para reinicios y sustituciones: cambiar uno por el otro. */
  tipo?: TipoLectura;
  motivo: string;
  confirmar?: boolean;
  ahora?: Date;
}): Promise<ResultadoRegistro> {
  if (!params.motivo?.trim()) throw new Error("Indique el motivo de la corrección");
  const lectura = await lecturaDeLaEmpresa(params.organizationId, params.readingId);
  const readingAt = params.readingAt ?? lectura.readingAt;
  const esEvento = lectura.tipo !== "LECTURA";
  const tipoNuevo = (esEvento ? params.tipo ?? lectura.tipo : "LECTURA") as TipoLectura;
  if (esEvento && tipoNuevo === "LECTURA") {
    throw new Error("Un reinicio o sustitución no se convierte en lectura: anúlelo y registre la lectura correcta.");
  }
  if (!esEvento && params.tipo && params.tipo !== "LECTURA") {
    throw new Error("Una lectura no se convierte en reinicio: anúlela y registre el reinicio o la sustitución.");
  }

  const { anterior, siguiente } = await vecinas(lectura.meterId, readingAt, lectura.id);
  const validacion = validarLectura({
    medidor: lectura.meter,
    anterior: esEvento ? null : anterior,
    siguiente,
    nueva: { value: params.value, readingAt, tipo: tipoNuevo, motivo: params.motivo },
    ahora: params.ahora,
  });
  if (validacion.nivel === "ERROR") throw new LecturaRechazada(validacion);
  if (validacion.nivel === "ADVERTENCIA" && !params.confirmar) {
    return { ok: false, requiereConfirmacion: true, validacion };
  }
  if (esEvento) {
    const rupturas = await nuevasRupturas(lectura.meter, (c) =>
      c.map((l) => (l.id === lectura.id ? { ...l, value: params.value, readingAt, tipo: tipoNuevo } : l)));
    if (rupturas.length) {
      throw new LecturaRechazada({
        ...validacion, nivel: "ERROR", codigo: "ROMPE_CONTINUIDAD",
        mensaje: `La corrección rompería la continuidad de lecturas posteriores: ${rupturas.join("; ")}. Corríjalas o anúlelas primero.`,
      });
    }
  }

  const ahora = params.ahora ?? new Date();
  const recalculo = await prisma.$transaction(async (tx) => {
    await tx.meterReading.update({
      where: { id: lectura.id },
      data: {
        value: params.value,
        readingAt,
        tipo: tipoNuevo,
        estado: "CORREGIDA",
        valorOriginal: lectura.valorOriginal ?? lectura.value,
        fechaOriginal: lectura.fechaOriginal ?? lectura.readingAt,
        tipoOriginal: lectura.tipoOriginal ?? (tipoNuevo !== lectura.tipo ? lectura.tipo : null),
        correccionPorId: params.userId,
        correccionEl: ahora,
        correccionMotivo: params.motivo.trim(),
        atipica: validacion.nivel === "ADVERTENCIA",
        justificacion: validacion.nivel === "ADVERTENCIA" ? params.motivo.trim() : lectura.justificacion,
      },
    });
    // Un evento que cambia de valor mueve el punto de partida de los planes.
    if (esEvento) await recorrerMetas(tx, params.organizationId, lectura.meterId, params.value - lectura.value);
    return recalcularEn(tx, params.organizationId, lectura.meterId, params.ahora);
  });

  await logAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    entity: "MeterReading",
    entityId: lectura.id,
    action: "CORREGIDA",
    summary: `${lectura.meter.name}: ${TIPOS_LECTURA[lectura.tipo as TipoLectura] ?? lectura.tipo} ${lectura.value} → ${params.value} ${lectura.meter.unit}. ${params.motivo.trim()}`,
    changes: {
      antes: { value: lectura.value, readingAt: lectura.readingAt.toISOString(), tipo: lectura.tipo, usuario: lectura.userId },
      despues: { value: params.value, readingAt: readingAt.toISOString(), tipo: tipoNuevo },
      motivo: params.motivo.trim(),
    },
  });

  return { ok: true, lecturaId: lectura.id, validacion, recalculo };
}

/**
 * Anula una lectura (sin borrarla) y recalcula sin ella. Un reinicio o
 * sustitucion anulado devuelve los planes al punto de partida anterior; si
 * quitarlo dejara lecturas posteriores sin continuidad, se niega y dice cuales.
 */
export async function anularLectura(params: {
  organizationId: string;
  readingId: string;
  userId: string;
  motivo: string;
  ahora?: Date;
}) {
  if (!params.motivo?.trim()) throw new Error("Indique el motivo de la anulación");
  const lectura = await lecturaDeLaEmpresa(params.organizationId, params.readingId);
  const esEvento = lectura.tipo !== "LECTURA";

  let valorAnterior = lectura.valorAnterior;
  if (esEvento) {
    const rupturas = await nuevasRupturas(lectura.meter, (c) => c.filter((l) => l.id !== lectura.id));
    if (rupturas.length) {
      throw new LecturaRechazada({
        nivel: "ERROR", codigo: "ROMPE_CONTINUIDAD",
        mensaje: `Anular este ${lectura.tipo === "REINICIO" ? "reinicio" : "cambio de medidor"} dejaría lecturas posteriores sin continuidad: ${rupturas.join("; ")}. ` +
          "Corrija el evento en vez de anularlo, o anule primero esas lecturas.",
        contexto: {
          anterior: null, anteriorEl: null, nueva: lectura.value, incremento: null, horasTranscurridas: null,
          usoPorDia: null, promedioDiario: lectura.meter.dailyAverage, maximoPermitido: null, unidad: lectura.meter.unit,
          alternativas: ["Corregir el valor o el tipo del evento", "Anular primero las lecturas posteriores que dependen de él"],
        },
      });
    }
    // Eventos sin el valor de antes guardado: el de la lectura vigente previa.
    if (valorAnterior === null) {
      const { anterior } = await vecinas(lectura.meterId, lectura.readingAt, lectura.id);
      valorAnterior = anterior?.value ?? 0;
    }
  }

  const ahora = params.ahora ?? new Date();
  const recalculo = await prisma.$transaction(async (tx) => {
    await tx.meterReading.update({
      where: { id: lectura.id },
      data: {
        estado: "ANULADA",
        correccionPorId: params.userId,
        correccionEl: ahora,
        correccionMotivo: params.motivo.trim(),
      },
    });
    if (esEvento) await recorrerMetas(tx, params.organizationId, lectura.meterId, (valorAnterior as number) - lectura.value);
    return recalcularEn(tx, params.organizationId, lectura.meterId, params.ahora);
  });

  await logAudit({
    organizationId: params.organizationId,
    userId: params.userId,
    entity: "MeterReading",
    entityId: lectura.id,
    action: "ANULADA",
    summary: `${lectura.meter.name}: ${esEvento ? (TIPOS_LECTURA[lectura.tipo as TipoLectura] ?? lectura.tipo).toLowerCase() : "lectura"} ${lectura.value} ${lectura.meter.unit} anulada. ${params.motivo.trim()}`,
    changes: {
      value: lectura.value, readingAt: lectura.readingAt.toISOString(), tipo: lectura.tipo, usuario: lectura.userId,
      valorAnterior, motivo: params.motivo.trim(),
    },
  });
  return recalculo;
}

export type Recalculo = {
  currentValue: number;
  dailyAverage: number;
  lastReadingAt: Date | null;
  lecturaVigente: boolean;
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
 * Cuando se estima que se alcanza la meta de uso, contada en dias completos
 * desde la medianoche de HOY en la zona de la empresa. Contar desde "ahora" al
 * milisegundo cambiaria la fecha con cada corrida y el recalculo no seria
 * idempotente. Vencido es hoy; sin promedio se supone una unidad por dia (la
 * misma regla que el programador).
 */
export function fechaEstimadaPorUso(meta: number, actual: number, promedio: number, hoy: Date): Date {
  const falta = meta - actual;
  if (falta <= 0) return hoy;
  const ritmo = promedio > 0 ? promedio : 1;
  return new Date(hoy.getTime() + Math.ceil(falta / ritmo) * DIA);
}

export type PlanDeRecalculo = {
  organizationId: string;
  meterId: string;
  medidor: string;
  activo: string;
  unidad: string;
  antes: { currentValue: number; dailyAverage: number; lastReadingAt: Date | null; lecturaVigente: boolean };
  despues: { currentValue: number; dailyAverage: number; lastReadingAt: Date | null; lecturaVigente: boolean };
  incrementos: Array<{ id: string; antes: number; despues: number }>;
  planes: Array<{
    id: string;
    plan: string;
    metaAntes: number | null;
    metaDespues: number | null;
    fechaAntes: Date | null;
    fechaDespues: Date | null;
    estadoAntes: EstadoPlanPorUso;
    estadoDespues: EstadoPlanPorUso;
  }>;
  lecturasSospechosas: Array<{ id: string; readingAt: Date; value: number; motivo: string }>;
  /** Registros que el recalculo escribiria (medidor + incrementos + planes). */
  registrosAModificar: number;
};

export type EstadoPlanPorUso = "VENCIDO" | "POR_VENCER" | "EN_TIEMPO" | "SIN_LECTURA" | "SIN_META";

function estadoPlanPorUso(meta: number | null, actual: number, promedio: number, vigente: boolean): EstadoPlanPorUso {
  if (meta === null) return "SIN_META";
  if (!vigente) return "SIN_LECTURA";
  const falta = meta - actual;
  if (falta <= 0) return "VENCIDO";
  return falta < (promedio > 0 ? promedio : 1) * DIAS_POR_VENCER ? "POR_VENCER" : "EN_TIEMPO";
}

const igualFecha = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Calcula, SIN escribir, lo que el recalculo de un medidor cambiaria. Lo usan
 * el recalculo normal y el script de ensayo: lo que se reporta es exactamente
 * lo que se aplicaria.
 *
 * No corrige lecturas: las que estan mal se reportan como sospechosas y siguen
 * contando tal cual hasta que alguien las corrija o anule.
 */
export async function planearRecalculo(
  cliente: Cliente,
  organizationId: string,
  meterId: string,
  ahora = new Date(),
  zona?: string,
): Promise<PlanDeRecalculo> {
  const medidor = await cliente.meter.findFirst({
    where: { id: meterId, organizationId },
    include: { asset: { select: { code: true } } },
  });
  if (!medidor) throw new Error("Medidor no encontrado");

  const [vigentes, total] = await Promise.all([
    cliente.meterReading.findMany({
      where: { meterId, organizationId, estado: { not: "ANULADA" } },
      orderBy: [{ readingAt: "asc" }, { id: "asc" }],
      select: { id: true, value: true, delta: true, readingAt: true, tipo: true, atipica: true },
    }),
    cliente.meterReading.count({ where: { meterId, organizationId } }),
  ]);

  // Incrementos: contra la lectura vigente anterior del mismo tramo.
  const incrementos: PlanDeRecalculo["incrementos"] = [];
  let previa: (typeof vigentes)[number] | null = null;
  for (const l of vigentes) {
    const delta = l.tipo !== "LECTURA" || !previa ? 0 : l.value - previa.value;
    if (Math.abs(delta - l.delta) > 1e-9) incrementos.push({ id: l.id, antes: l.delta, despues: delta });
    previa = l;
  }

  const ultima = vigentes.at(-1) ?? null;
  let despues: PlanDeRecalculo["despues"];
  if (ultima) {
    despues = {
      currentValue: ultima.value,
      lastReadingAt: ultima.readingAt,
      dailyAverage: promedioDiario(vigentes, medidor.tipo) ?? 0,
      lecturaVigente: true,
    };
  } else if (total === 0) {
    // Nunca tuvo lecturas: vale lo que se capturo al darlo de alta.
    despues = { currentValue: medidor.currentValue, lastReadingAt: null, dailyAverage: 0, lecturaVigente: true };
  } else if (medidor.valorInicial !== null) {
    despues = { currentValue: medidor.valorInicial, lastReadingAt: null, dailyAverage: 0, lecturaVigente: true };
  } else {
    // Todas anuladas y sin valor inicial formal: no se inventa un actual.
    despues = { currentValue: 0, lastReadingAt: null, dailyAverage: 0, lecturaVigente: false };
  }

  const zonaEmpresa = zona ?? (await cliente.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }))?.timezone ?? "America/Mexico_City";
  const [anio, mes, dia] = claveDiaEnZona(ahora, zonaEmpresa).split("-").map(Number);
  const hoy = medianocheEnZona(anio, mes, dia, zonaEmpresa);

  const asignaciones = await cliente.planAsset.findMany({
    where: { organizationId, meterId, active: true, plan: { triggerType: "METER" } },
    select: { id: true, nextDueMeter: true, nextDueDate: true, plan: { select: { name: true } } },
  });
  const planes: PlanDeRecalculo["planes"] = asignaciones.map((a) => {
    const fechaDespues = !despues.lecturaVigente || a.nextDueMeter === null
      ? null
      : fechaEstimadaPorUso(a.nextDueMeter, despues.currentValue, despues.dailyAverage, hoy);
    return {
      id: a.id,
      plan: a.plan.name,
      metaAntes: a.nextDueMeter,
      metaDespues: a.nextDueMeter,
      fechaAntes: a.nextDueDate,
      fechaDespues: a.nextDueMeter === null ? a.nextDueDate : fechaDespues,
      estadoAntes: estadoPlanPorUso(a.nextDueMeter, medidor.currentValue, medidor.dailyAverage, medidor.lecturaVigente),
      estadoDespues: estadoPlanPorUso(a.nextDueMeter, despues.currentValue, despues.dailyAverage, despues.lecturaVigente),
    };
  });

  const problemas = problemasDeCadena(vigentes, medidor);
  const lecturasSospechosas = vigentes
    .filter((l) => problemas.has(l.id))
    .map((l) => ({ id: l.id, readingAt: l.readingAt, value: l.value, motivo: problemas.get(l.id)! }));

  const antes = {
    currentValue: medidor.currentValue,
    dailyAverage: medidor.dailyAverage,
    lastReadingAt: medidor.lastReadingAt,
    lecturaVigente: medidor.lecturaVigente,
  };
  const cambiaMedidor =
    Math.abs(antes.currentValue - despues.currentValue) > 1e-9 ||
    Math.abs(antes.dailyAverage - despues.dailyAverage) > 1e-9 ||
    !igualFecha(antes.lastReadingAt, despues.lastReadingAt) ||
    antes.lecturaVigente !== despues.lecturaVigente;

  return {
    organizationId,
    meterId,
    medidor: medidor.name,
    activo: medidor.asset.code,
    unidad: medidor.unit,
    antes,
    despues,
    incrementos,
    planes,
    lecturasSospechosas,
    registrosAModificar:
      (cambiaMedidor ? 1 : 0) +
      incrementos.length +
      planes.filter((p) => !igualFecha(p.fechaAntes, p.fechaDespues) || p.metaAntes !== p.metaDespues).length,
  };
}

/** Escribe un plan de recalculo. Solo lo que cambia: correrlo dos veces no hace nada. */
export async function aplicarRecalculo(tx: Cliente, plan: PlanDeRecalculo) {
  const cambiaMedidor =
    Math.abs(plan.antes.currentValue - plan.despues.currentValue) > 1e-9 ||
    Math.abs(plan.antes.dailyAverage - plan.despues.dailyAverage) > 1e-9 ||
    !igualFecha(plan.antes.lastReadingAt, plan.despues.lastReadingAt) ||
    plan.antes.lecturaVigente !== plan.despues.lecturaVigente;
  if (cambiaMedidor) {
    await tx.meter.update({ where: { id: plan.meterId }, data: plan.despues });
  }
  for (const i of plan.incrementos) {
    await tx.meterReading.update({ where: { id: i.id }, data: { delta: i.despues } });
  }
  for (const p of plan.planes) {
    if (!igualFecha(p.fechaAntes, p.fechaDespues)) {
      await tx.planAsset.update({ where: { id: p.id }, data: { nextDueDate: p.fechaDespues } });
    }
  }
}

async function recalcularEn(tx: Cliente, organizationId: string, meterId: string, ahora = new Date()): Promise<Recalculo> {
  const plan = await planearRecalculo(tx, organizationId, meterId, ahora);
  await aplicarRecalculo(tx, plan);
  const vigentes = await tx.meterReading.count({ where: { meterId, organizationId, estado: { not: "ANULADA" } } });
  return { ...plan.despues, lecturasValidas: vigentes, planesRecalculados: plan.planes.length };
}

/**
 * Rehace todo lo que depende de las lecturas de un medidor: incrementos, valor
 * actual, promedio diario, vigencia y la fecha estimada de los planes por uso.
 * En una transaccion: o queda todo, o nada.
 */
export async function recalcularMedidor(organizationId: string, meterId: string, ahora = new Date()): Promise<Recalculo> {
  return prisma.$transaction((tx) => recalcularEn(tx, organizationId, meterId, ahora));
}
