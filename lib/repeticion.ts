/**
 * El doble toque: en el teléfono, un dedo que rebota o una señal lenta mandan
 * la misma captura dos veces. En un consumo de refacción eso son dos salidas
 * de almacén; en horas, jornada doble.
 *
 * Dos defensas, porque ninguna basta sola:
 *
 *  - Candado en proceso: dos peticiones idénticas que llegan juntas se
 *    atienden una tras otra, no a la vez. Sin esto las dos pasan la revisión
 *    antes de que la primera escriba.
 *  - Revisión en la base: si la misma persona registró exactamente lo mismo en
 *    la misma orden hace menos de VENTANA_MS, la segunda se rechaza con 409 y
 *    un mensaje que dice que la primera sí quedó.
 *
 * Capturar lo mismo a propósito (dos veces 1 pieza) sigue siendo posible
 * pasados unos segundos.
 */
export const VENTANA_MS = 10_000;

const enCurso = new Map<string, Promise<unknown>>();

/** Ejecuta `fn` en fila con cualquier otra llamada de la misma `clave`. */
export async function enFila<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const previa = enCurso.get(clave) ?? Promise.resolve();
  const actual = previa.catch(() => undefined).then(fn);
  enCurso.set(clave, actual);
  try {
    return await actual;
  } finally {
    if (enCurso.get(clave) === actual) enCurso.delete(clave);
  }
}

export const hace = (ms = VENTANA_MS) => new Date(Date.now() - ms);
