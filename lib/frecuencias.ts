/**
 * La frecuencia de cada actividad dentro de un plan.
 *
 * El usuario piensa en DIAS —"el aceite cada 30, el liquido de frenos cada
 * 180"— y el programador necesita MULTIPLOS de una cadencia base. Esta es la
 * traduccion entre los dos, y vive en un solo lugar porque la usan la pantalla
 * del plan, el alta, la importacion y el generador de IA. Repartirla seria
 * garantizar que un dia dejen de coincidir.
 *
 * ── Por que multiplos y no un calendario por actividad ──
 *
 * Porque el anidamiento sale gratis. Con base mensual y actividades de cada 1,
 * cada 3 y cada 6, la ejecucion 6 lleva las TRES: una sola visita con todo lo
 * que toca. Un calendario por actividad tendria que juntarlas despues, y el
 * programador hoy no junta nada —crea una orden por asignacion—.
 */

/** Maximo comun divisor. La cadencia base sale de aqui. */
function mcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : mcd(b, a % b);
}

export type ActividadConDias = { cadaDias: number };
export type ActividadDerivada = { cadaDias: number; cadaCuantas: number };

export type Derivacion = {
  /** La cadencia del plan: cada cuantos dias se visita el equipo. */
  base: number;
  actividades: ActividadDerivada[];
  /**
   * Los dias que el usuario pidio y NO son multiplo exacto de la base.
   *
   * No deberia pasar —la base es el maximo comun divisor de todos—, pero si
   * alguien captura 0 o un negativo, se sanea y se avisa en vez de guardar un
   * calendario que nadie puede cumplir.
   */
  ajustados: Array<{ pidio: number; queda: number }>;
};

/**
 * De los dias de cada actividad, la cadencia base y sus multiplos.
 *
 * La base es el maximo comun divisor: con 30 y 180 dias la base es 30 y los
 * multiplos 1 y 6. Con 45 y 30 la base es 15 y los multiplos 3 y 2 —y ahi
 * habra ciclos donde no toca nada, que el programador tiene que SALTAR en vez
 * de emitir una orden vacia.
 */
export function derivarCadencia(actividades: ActividadConDias[]): Derivacion {
  const ajustados: Derivacion["ajustados"] = [];
  const dias = actividades.map((a) => {
    const limpio = Math.round(a.cadaDias);
    if (!Number.isFinite(limpio) || limpio < 1) {
      ajustados.push({ pidio: a.cadaDias, queda: 1 });
      return 1;
    }
    return limpio;
  });

  if (!dias.length) return { base: 0, actividades: [], ajustados };

  const base = dias.reduce((acc, d) => mcd(acc, d), dias[0]);
  return {
    base,
    actividades: dias.map((d) => ({ cadaDias: d, cadaCuantas: Math.max(Math.round(d / base), 1) })),
    ajustados,
  };
}

/** Que actividades tocan en la ejecucion numero `n` (empezando en 1). */
export function tocanEn<T extends { cadaCuantas: number }>(actividades: T[], n: number): T[] {
  if (n < 1) return [];
  return actividades.filter((a) => n % Math.max(a.cadaCuantas, 1) === 0);
}

/**
 * Cuantos dias representa una actividad, para enseñarlo en pantalla.
 *
 * No se guardan los dias: se guarda el multiplo y aqui se vuelven dias. Guardar
 * los dos seria dejar abierta la puerta a que se contradigan el dia que alguien
 * cambie la base.
 */
export function diasDe(cadaCuantas: number, base: number): number {
  return Math.max(cadaCuantas, 1) * base;
}
