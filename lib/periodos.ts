/**
 * Los periodos de los indicadores, en un solo lugar.
 *
 * Antes cada modulo armaba su propio periodo: "ahora menos 90 dias" al
 * milisegundo, en la zona del servidor (UTC en produccion). Abrir el Panel a
 * las 10 de la manana y Reportes a las 6 de la tarde daba dos ventanas
 * distintas para "los ultimos 90 dias", y un evento de las 11 pm de Monterrey
 * caia en el dia siguiente. Dos cifras distintas para la misma pregunta.
 *
 * Reglas, iguales para todos los modulos:
 *
 *  - **Dias completos de calendario en la zona horaria de la empresa**
 *    (`Organization.timezone`), no en la del servidor ni la del navegador.
 *  - **Intervalo semiabierto `[desde, hasta)`**: `hasta` es la medianoche que
 *    ABRE el dia siguiente a hoy. Asi un periodo y el anterior no se enciman ni
 *    dejan huecos, y un evento cae en exactamente un periodo.
 *  - **Hoy cuenta completo**: "ultimos 30 dias" son hoy y los 29 anteriores.
 */

export const PERIODOS_INDICADORES = {
  30: "30 días",
  90: "90 días",
  180: "6 meses",
  365: "12 meses",
} as const;

export type DiasDePeriodo = keyof typeof PERIODOS_INDICADORES;

export function esDiasDePeriodo(v: unknown): v is DiasDePeriodo {
  return typeof v === "number" && v in PERIODOS_INDICADORES;
}

export const ZONA_POR_OMISION = "America/Mexico_City";

export type Periodo = {
  desde: Date;
  /** Exclusivo: la medianoche que abre el dia siguiente al ultimo del periodo. */
  hasta: Date;
  dias: number;
  zonaHoraria: string;
  etiqueta: string;
};

/** Minutos que la zona esta adelantada respecto a UTC en ese instante (Mexico: negativo). */
function desfaseMinutos(zona: string, instante: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const comoUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return Math.round((comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60_000);
}

/** El dia de calendario (anio, mes 1-12, dia) de un instante, visto desde la zona. */
export function diaEnZona(instante: Date, zona: string): { anio: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return { anio: v("year"), mes: v("month"), dia: v("day") };
}

/** "aaaa-mm-dd" del dia de un instante en la zona. */
export function claveDiaEnZona(instante: Date, zona: string): string {
  const d = diaEnZona(instante, zona);
  return `${d.anio}-${String(d.mes).padStart(2, "0")}-${String(d.dia).padStart(2, "0")}`;
}

/**
 * El instante UTC de la medianoche de ese dia de calendario en la zona.
 *
 * Se corrige dos veces por si ese dia cambia el horario: el desfase se mide en
 * la medianoche aproximada y se vuelve a medir en el resultado.
 */
export function medianocheEnZona(anio: number, mes: number, dia: number, zona: string): Date {
  const base = Date.UTC(anio, mes - 1, dia);
  let t = base - desfaseMinutos(zona, new Date(base)) * 60_000;
  t = base - desfaseMinutos(zona, new Date(t)) * 60_000;
  return new Date(t);
}

/**
 * El periodo de los ultimos `dias` dias completos, terminando hoy, en la zona.
 *
 * `ahora` se recibe para que las pruebas fijen el reloj; en produccion es el
 * momento de la consulta.
 */
export function periodoIndicadores(
  dias: number,
  zona: string = ZONA_POR_OMISION,
  ahora: Date = new Date(),
): Periodo {
  const hoy = diaEnZona(ahora, zona);
  const hasta = medianocheEnZona(hoy.anio, hoy.mes, hoy.dia + 1, zona);
  const desde = medianocheEnZona(hoy.anio, hoy.mes, hoy.dia + 1 - dias, zona);
  const etiqueta = esDiasDePeriodo(dias) ? PERIODOS_INDICADORES[dias] : `${dias} días`;
  return { desde, hasta, dias, zonaHoraria: zona, etiqueta };
}

/** El periodo del mismo largo inmediatamente anterior, para comparar. */
export function periodoAnterior(p: Periodo): Periodo {
  const d = diaEnZona(p.desde, p.zonaHoraria);
  return {
    desde: medianocheEnZona(d.anio, d.mes, d.dia - p.dias, p.zonaHoraria),
    hasta: p.desde,
    dias: p.dias,
    zonaHoraria: p.zonaHoraria,
    etiqueta: `${p.etiqueta} anteriores`,
  };
}

/** El filtro de Prisma para un campo fecha dentro del periodo `[desde, hasta)`. */
export function dentroDe(p: { desde: Date; hasta: Date }) {
  return { gte: p.desde, lt: p.hasta };
}

/** Si un instante cae dentro del periodo `[desde, hasta)`. */
export function caeEn(instante: Date | null | undefined, p: { desde: Date; hasta: Date }): boolean {
  return !!instante && instante >= p.desde && instante < p.hasta;
}

/** "18 ago 2026 al 16 sep 2026": el primer y el ultimo dia del periodo, en su zona. */
export function describirPeriodo(p: { desde: Date; hasta: Date; zonaHoraria: string }): string {
  const f = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: p.zonaHoraria });
  return `${f.format(p.desde)} al ${f.format(new Date(p.hasta.getTime() - 1))}`;
}

/** Fecha y hora de un instante en la zona de la empresa. */
export function fechaHoraEnZona(instante: Date, zona: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: zona }).format(instante);
}

/** Lee `?dias=` de la URL; cualquier otro valor cae a 90. */
export function diasDeParametro(v: string | undefined, porOmision: DiasDePeriodo = 90): DiasDePeriodo {
  const n = Number(v);
  return esDiasDePeriodo(n) ? n : porOmision;
}
