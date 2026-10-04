/**
 * Cuando una alerta predictiva sigue abierta.
 *
 * Reconocer una alerta NO la cierra. Alguien la vio; el equipo sigue igual.
 * El dominio ya lo tenia decidido —`cerrarAlerta` en `lib/predictive.ts`
 * contesta «La alerta ya esta cerrada» a todo lo que no sea uno de estos dos
 * estados—, pero cada pantalla repetia el criterio por su cuenta y tres se
 * quedaron contando solo las que nadie habia tocado.
 *
 * El resultado se veia bien en las dos pantallas y no cuadraba entre ellas: el
 * Inicio contaba una alerta reconocida y el parte del dia, con los mismos
 * datos del mismo dia, no la contaba. Dos respuestas para la misma pregunta,
 * y ninguna forma de saber cual servia.
 *
 * Aqui vive el criterio, una sola vez.
 *
 * ── Lo que NO usa este filtro, a proposito ──
 *
 * Hay dos lugares que miran solo `OPEN`, y estan bien asi porque preguntan
 * otra cosa:
 *
 * - El aviso de alerta nueva, en `lib/avisos/detectores.ts`: volver a avisar
 *   de una que alguien ya reconocio es ruido, no informacion.
 * - El escalamiento `ALERTA_CRITICA_SIN_RECONOCER`, en
 *   `lib/avisos/escalamiento.ts`: «sin reconocer» es literalmente lo que
 *   pregunta.
 *
 * Si alguna vez uno de esos dos empieza a usar este filtro, deja de hacer su
 * trabajo. No es que se les haya olvidado.
 */

/** Una alerta abierta es la que todavia no se cierra, reconocida o no. */
export const ESTADOS_ALERTA_ABIERTA = ["OPEN", "ACKNOWLEDGED"] as const;

/**
 * El filtro de Prisma para «las alertas que siguen abiertas».
 *
 * Es funcion y no constante para que nadie se lleve el mismo objeto a dos
 * consultas y lo modifique en una sin querer.
 */
export function alertaAbierta() {
  return { status: { in: [...ESTADOS_ALERTA_ABIERTA] } };
}

/** Si una alerta, ya leida, sigue abierta. */
export function estaAbierta(status: string): boolean {
  return (ESTADOS_ALERTA_ABIERTA as readonly string[]).includes(status);
}
