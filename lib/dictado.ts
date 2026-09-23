/**
 * Dictar: lo que vale igual en el navegador y en el servidor.
 *
 * Este archivo NO importa nada, y es a proposito: lo usa el boton de dictado
 * —que corre en el telefono del tecnico— y tambien la ruta que recibe el
 * audio. Si importara prisma por el camino, la compilacion del cliente se
 * caeria con un «no encuentro tls» que no dice nada de la causa. Es el mismo
 * criterio de `lib/motivos-movimiento.ts` y `lib/estados-compra.ts`, que lo
 * aprendieron por las malas.
 *
 * El tope de segundos vive aqui porque lo necesitan los dos lados: el
 * navegador para cortar la grabacion y el servidor para decir por que la
 * rechaza. Escrito en cada lado eran dos numeros que un dia iban a dejar de
 * coincidir, y el sintoma habria sido una grabacion que se corta sola y aun
 * asi la rechazan por larga.
 */

/**
 * Lo que se acepta dictar de una vez, en segundos.
 *
 * Sesenta y no mas porque el reconocimiento de una sola pasada de Google no
 * llega mas alla; de ahi en adelante hay que irse al modo por lotes, que
 * contesta despues y no sirve para alguien parado frente a la maquina.
 *
 * Y sesenta alcanza de sobra: un cierre dictado completo —que se encontro,
 * que se hizo, cuanto tardo, que refacciones se usaron— cabe en veinte o
 * treinta. Quien necesite mas, dicta otra vez y se agrega a lo anterior.
 */
export const MAXIMO_SEGUNDOS_DICTADO = 60;

/**
 * Une lo dictado con lo que ya habia.
 *
 * Se AGREGA, nunca se reemplaza. Quien dicta por segunda vez esta
 * completando, no corrigiendo: pisar lo anterior le borraria lo que ya habia
 * dicho —o lo que habia escrito a mano antes de acordarse del microfono— y
 * eso solo se nota cuando ya se perdio.
 *
 * El punto de por medio no es cosmetico: lo dictado llega con su propia
 * puntuacion, y pegar dos dictados sin separarlos arma un parrafo corrido que
 * despues nadie relee —y de ese texto sale la codificacion de la falla—.
 */
export function unirDictado(previo: string, dictado: string): string {
  const antes = previo.trimEnd();
  const nuevo = dictado.trim();
  if (!nuevo) return previo;
  if (!antes) return nuevo;
  return /[.!?…,:;]$/.test(antes) ? `${antes} ${nuevo}` : `${antes}. ${nuevo}`;
}

/**
 * Por que no se pudo, en palabras y con que hacer.
 *
 * Son cinco problemas distintos con cinco soluciones distintas, y estaban
 * todos bajo el mismo «no se pudo usar el microfono». Con ese mensaje, un
 * bloqueo del servidor mandaba a la gente a revisar los ajustes de su Mac —y
 * ahi no habia nada que arreglar—.
 *
 * El nombre del error lo da el navegador y esta estandarizado; lo que cambia
 * entre navegadores es el texto, que no se usa.
 */
export function porQueNoSePudo(e: unknown): string {
  const nombre = (e as { name?: string })?.name ?? "";
  switch (nombre) {
    case "NotAllowedError":
    case "SecurityError":
      // La causa mas comun, y la unica que la persona puede arreglar sola.
      return "No dio permiso para el micrófono. Tóquelo en el candado de la barra de direcciones y recargue. Si aun así no deja, revise que su sistema permita al navegador usar el micrófono.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Este equipo no tiene micrófono disponible.";
    case "NotReadableError":
    case "AbortError":
      // Clasico: una videollamada abierta en otra pestaña.
      return "Otro programa está usando el micrófono. Ciérrelo e intente de nuevo.";
    default:
      return "No se pudo usar el micrófono.";
  }
}
