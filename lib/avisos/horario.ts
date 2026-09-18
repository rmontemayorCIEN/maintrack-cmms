/**
 * Cuándo se puede molestar a alguien.
 *
 * Los avisos no críticos respetan una ventana —por omisión de 8:00 a 18:00 en
 * la zona de la empresa, en sus días laborables y fuera de sus festivos—. Un
 * aviso que nace fuera de la ventana se programa para su inicio; uno crítico
 * sale siempre.
 *
 * Puro: recibe la jornada ya leída, así lo usan el emisor, el escalamiento y
 * las pruebas con el reloj que quieran.
 */
import { claveDiaEnZona, diaEnZona, medianocheEnZona } from "../periodos";

export type Ventana = {
  zona: string;
  /** "HH:MM" */
  horaInicio: string;
  horaFin: string;
  /** 1 = lunes … 7 = domingo */
  diasHabiles: number[];
  /** "aaaa-mm-dd" */
  festivos: string[];
};

const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** Día de la semana ISO (1 lunes … 7 domingo) de un instante en la zona. */
function diaSemanaEnZona(instante: Date, zona: string): number {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: zona, weekday: "short" }).format(instante);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[d] ?? 1;
}

/** Minutos transcurridos desde la medianoche local. */
function minutoDelDia(instante: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return v("hour") * 60 + v("minute");
}

export function esDiaLaborable(instante: Date, v: Ventana): boolean {
  if (!v.diasHabiles.includes(diaSemanaEnZona(instante, v.zona))) return false;
  return !v.festivos.includes(claveDiaEnZona(instante, v.zona));
}

/** Si ahora es buen momento para un aviso no crítico. */
export function dentroDeVentana(instante: Date, v: Ventana): boolean {
  if (!esDiaLaborable(instante, v)) return false;
  const m = minutoDelDia(instante, v.zona);
  return m >= minutos(v.horaInicio) && m < minutos(v.horaFin);
}

/** El instante en que abre la ventana ese día de calendario local. */
function aperturaDelDia(instante: Date, v: Ventana): Date {
  const d = diaEnZona(instante, v.zona);
  return new Date(medianocheEnZona(d.anio, d.mes, d.dia, v.zona).getTime() + minutos(v.horaInicio) * 60_000);
}

/**
 * El siguiente momento dentro de la ventana, a partir de `instante`. Si ya está
 * dentro, es el mismo instante. Busca hasta 21 días: una empresa sin ningún
 * día laborable configurado no deja el aviso colgado para siempre.
 */
export function siguienteMomentoHabil(instante: Date, v: Ventana): Date {
  if (dentroDeVentana(instante, v)) return instante;
  let dia = instante;
  for (let i = 0; i < 21; i++) {
    const apertura = aperturaDelDia(dia, v);
    if (apertura.getTime() > instante.getTime() && esDiaLaborable(apertura, v)) return apertura;
    // Al día siguiente: 26 h para no caer dos veces en el mismo día con el cambio de horario.
    const d = diaEnZona(dia, v.zona);
    dia = new Date(medianocheEnZona(d.anio, d.mes, d.dia, v.zona).getTime() + 26 * 3_600_000);
  }
  return instante;
}

/**
 * Suma minutos de espera. Con `soloJornada`, el tiempo fuera de la ventana no
 * cuenta: una espera de 4 h que empieza a las 17:00 termina a las 11:00 del
 * siguiente día laborable, no a las 21:00.
 */
export function sumarEspera(desde: Date, minutosEspera: number, v: Ventana, soloJornada: boolean): Date {
  if (!soloJornada) return new Date(desde.getTime() + minutosEspera * 60_000);
  let restante = minutosEspera;
  let cursor = siguienteMomentoHabil(desde, v);
  for (let i = 0; i < 60 && restante > 0; i++) {
    const cierre = new Date(aperturaDelDia(cursor, v).getTime() + (minutos(v.horaFin) - minutos(v.horaInicio)) * 60_000);
    const disponible = Math.max(0, (cierre.getTime() - cursor.getTime()) / 60_000);
    if (restante <= disponible) return new Date(cursor.getTime() + restante * 60_000);
    restante -= disponible;
    cursor = siguienteMomentoHabil(new Date(cierre.getTime() + 60_000), v);
  }
  return cursor;
}

/** Hora local "HH:MM" de un instante. */
export function horaLocal(instante: Date, zona: string): string {
  const m = minutoDelDia(instante, zona);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export { diaSemanaEnZona, minutos as minutosDeHora };
