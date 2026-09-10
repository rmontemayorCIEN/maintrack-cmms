/**
 * La aritmetica de fechas del mantenimiento, en un solo lugar.
 *
 * "Cada 15 dias", "cada semana", "mensual", "trimestral" no son la misma
 * operacion, y hasta hoy el sistema las representaba todas igual: un numero de
 * dias corridos. Con eso "mensual" terminaba siendo 30 dias, que en un ano se
 * corre cinco dias, y "cada 15 dias" no podia significar 15 dias de trabajo
 * aunque para una maquina sea justo lo que significa —se desgasta operando, no
 * en el almanaque—.
 *
 * Aqui viven las tres unidades y la unica regla que las distingue. Las usan el
 * programador, la proyeccion, el armado de ordenes y la pantalla del plan; si
 * la aritmetica se repartiera entre los cuatro, un dia dejarian de coincidir y
 * nadie sabria cual fecha es la buena.
 */
import { esHabil, type Jornada } from "./agenda";

export const UNIDADES = {
  DIAS: "DIAS",
  SEMANAS: "SEMANAS",
  MESES: "MESES",
} as const;

export type Unidad = keyof typeof UNIDADES;

export const ETIQUETA_UNIDAD: Record<Unidad, { singular: string; plural: string }> = {
  DIAS: { singular: "día", plural: "días" },
  SEMANAS: { singular: "semana", plural: "semanas" },
  MESES: { singular: "mes", plural: "meses" },
};

export function esUnidad(v: unknown): v is Unidad {
  return typeof v === "string" && v in UNIDADES;
}

/**
 * Como cuenta los dias esta organizacion.
 *
 * `habiles` sale de `Organization.otDiasHabiles` y la jornada de la pestana
 * "Jornada y calendario" —los mismos dias laborables y festivos que ya usan la
 * carga del personal y el recorrido de vencimientos—. Un solo lugar decide que
 * dia es habil; el parametro nuevo NO trae su propia lista.
 */
export type ReglaCalendario = {
  habiles: boolean;
  jornada: Jornada;
};

/**
 * Suma dias habiles, saltando los que no lo son.
 *
 * Es distinto de recorrer al siguiente habil, que es lo que hacia el sistema
 * hasta hoy: recorrer ajusta el resultado, contar cambia el resultado. Del
 * viernes 4 de septiembre de 2026, 15 dias corridos caen el sabado 19; 15 dias
 * habiles con jornada de lunes a sabado caen el martes 22. Tres dias de
 * diferencia sobre el mismo dato.
 *
 * El tope evita un ciclo infinito si alguien deja la organizacion sin ningun
 * dia habil configurado: en ese caso se cae a dias corridos, que es una
 * respuesta imperfecta pero acotada, en vez de colgar el programador.
 */
export function sumarDiasHabiles(desde: Date, dias: number, j: Jornada): Date {
  const d = new Date(desde);
  if (dias <= 0) return d;
  if (!j.diasHabiles.length) return sumarDiasCorridos(desde, dias);

  let contados = 0;
  let guarda = 0;
  const tope = dias * 7 + 400; // holgura para festivos largos
  while (contados < dias && guarda < tope) {
    d.setDate(d.getDate() + 1);
    guarda += 1;
    if (esHabil(d, j)) contados += 1;
  }
  return d;
}

export function sumarDiasCorridos(desde: Date, dias: number): Date {
  const d = new Date(desde);
  d.setDate(d.getDate() + dias);
  return d;
}

/**
 * Suma meses de calendario, no bloques de 30 dias.
 *
 * El caso que decide la regla es el dia 31. Del 31 de enero, "mensual" no
 * puede caer el 31 de febrero porque no existe: cae el 28. Lo que si seria un
 * error es que el siguiente se quedara pegado en 28 y el plan se recorriera
 * tres dias para siempre. Por eso el dia que se quiere se conserva aparte y se
 * RECORTA al largo de cada mes, en vez de arrastrar el recorte:
 *
 *     31 ene → 28 feb → 31 mar → 30 abr → 31 may
 *
 * `diaDeseado` es el dia al que la actividad esta anclada. Quien llama decide
 * cual es —y esa decision no es cosmetica—:
 *
 *  - Con `recalculoPlan` en CIERRE, el ancla es el dia en que de verdad se
 *    hizo. El calendario sigue a la realidad, que es lo correcto cuando lo que
 *    importa es cuanto lleva operando el equipo.
 *  - Con PROGRAMADO, el ancla es el dia del arranque declarado. El calendario
 *    no se desplaza aunque un mes se haya cerrado tarde.
 */
export function sumarMeses(desde: Date, meses: number, diaDeseado?: number): Date {
  const dia = diaDeseado ?? desde.getDate();
  const d = new Date(desde);
  // Se para en el dia 1 antes de mover el mes: sin esto, pasar de un 31 a un
  // mes de 30 hace que JavaScript se desborde al mes siguiente por su cuenta
  // —el 31 de septiembre se convierte en 1 de octubre— y el recorte llegaria
  // tarde.
  d.setDate(1);
  d.setMonth(d.getMonth() + meses);
  d.setDate(Math.min(dia, diasDelMes(d.getFullYear(), d.getMonth())));
  return d;
}

/** Cuantos dias tiene el mes: el dia 0 del siguiente es el ultimo de este. */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes + 1, 0).getDate();
}

/**
 * La fecha siguiente de una actividad, segun su intervalo y su unidad.
 *
 * Los dias habiles aplican SOLO a los intervalos expresados en dias. Un
 * trimestre son tres meses aunque la planta cierre dos semanas, y contar un
 * semestre en dias habiles no significa nada. La regla no es una comodidad:
 * mezclar las dos formas daria dos calendarios distintos para la misma
 * frecuencia segun como se hubiera capturado.
 */
export function siguienteFecha(
  desde: Date,
  cadaCuanto: number,
  unidad: Unidad,
  regla: ReglaCalendario,
  diaDeseado?: number,
): Date {
  const n = Math.max(Math.round(cadaCuanto), 1);
  if (unidad === "MESES") return sumarMeses(desde, n, diaDeseado);
  if (unidad === "SEMANAS") return sumarDiasCorridos(desde, n * 7);
  return regla.habiles ? sumarDiasHabiles(desde, n, regla.jornada) : sumarDiasCorridos(desde, n);
}

/**
 * Los dias que dura un intervalo, para ordenar y para comparar.
 *
 * Es una APROXIMACION y no sirve para calcular fechas —para eso esta
 * `siguienteFecha`—. Se usa donde hace falta un solo numero: ordenar las
 * actividades de la mas frecuente a la menos, decidir si una vence antes que
 * otra en la pantalla, o migrar los multiplos viejos.
 */
export function diasAproximados(cadaCuanto: number, unidad: Unidad): number {
  const n = Math.max(Math.round(cadaCuanto), 1);
  if (unidad === "MESES") return Math.round(n * 30.44);
  if (unidad === "SEMANAS") return n * 7;
  return n;
}

/**
 * De un numero de dias, la forma en que una persona lo diria.
 *
 * Sirve para migrar lo viejo —donde todo eran dias— sin dejar "cada 90 dias"
 * escrito donde el usuario habia querido decir "trimestral". Solo convierte
 * cuando la division es exacta: 90 dias son 3 meses, pero 100 dias son 100
 * dias y asi se quedan.
 */
export function desdeDias(dias: number): { cadaCuanto: number; unidad: Unidad } {
  const d = Math.max(Math.round(dias), 1);
  for (const meses of [1, 2, 3, 4, 6, 12]) {
    if (d === Math.round(meses * 30.44) || d === meses * 30) {
      return { cadaCuanto: meses, unidad: "MESES" };
    }
  }
  if (d % 7 === 0 && d >= 7 && d <= 8 * 7) return { cadaCuanto: d / 7, unidad: "SEMANAS" };
  return { cadaCuanto: d, unidad: "DIAS" };
}

/** "Cada 15 días", "Mensual", "Cada 3 meses". Para pantalla y para la IA. */
export function describirIntervalo(cadaCuanto: number, unidad: Unidad): string {
  const n = Math.max(Math.round(cadaCuanto), 1);
  if (n === 1) {
    if (unidad === "MESES") return "Mensual";
    if (unidad === "SEMANAS") return "Semanal";
    return "Diario";
  }
  if (unidad === "MESES" && n === 3) return "Trimestral";
  if (unidad === "MESES" && n === 6) return "Semestral";
  if (unidad === "MESES" && n === 12) return "Anual";
  if (unidad === "SEMANAS" && n === 2) return "Quincenal";
  return `Cada ${n} ${ETIQUETA_UNIDAD[unidad].plural}`;
}
