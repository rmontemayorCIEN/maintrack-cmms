/**
 * Que tan larga es la respuesta que se DICE en voz alta.
 *
 * ── El problema, medido ──
 *
 * Rafael pregunto «¿cuantos activos tenemos?» en su telefono y el sistema le
 * contesto cincuenta y tres segundos. La respuesta —735 caracteres— traia el
 * numero, la aclaracion de que los retirados no cuentan, donde ver el padron
 * completo, y de pendiente el cumplimiento preventivo y el backlog. Todo
 * cierto y todo util; nada de eso se pregunto.
 *
 * Y la verbosidad no es una mania del modelo: se la pedimos nosotros, en el
 * punto 5 de sus instrucciones —«si nota algo que cambia la lectura,
 * mencionelo»—. Esa regla es buena: es la que avisa «ojo, la mitad de sus
 * fallas no tiene causa raiz». En pantalla vale; dicha en voz convierte cada
 * pregunta en un informe.
 *
 * ── Por que manda solo sobre lo hablado ──
 *
 * Lo escrito sale COMPLETO siempre. El contexto de mas si vale, y tirarlo
 * seria arreglar un problema creando otro. Lo que se acota es el tiempo que
 * alguien esta parado oyendo, que es el recurso escaso.
 *
 * ── Por que dos niveles y no tres ──
 *
 * «Mediana» obliga a quien configura a adivinar que significa, y en la
 * practica no la escoge nadie. Dos se entienden sin explicacion.
 *
 * ── Sin dependencias, a proposito ──
 *
 * Lo lee la pantalla de Ajustes, que corre en el navegador.
 */

export const LARGOS_DE_RESPUESTA = [
  {
    clave: "CONCISA",
    etiqueta: "Concisa",
    explica: "Dice la respuesta y ya. El detalle queda escrito en pantalla.",
    /** Para poder decir en Ajustes que se gana, no solo que se escoge. */
    aproximado: "unos 15 segundos",
  },
  {
    clave: "COMPLETA",
    etiqueta: "Completa",
    explica: "Dice todo, incluido el contexto que no pidió pero cambia la lectura.",
    aproximado: "puede pasar de 45 segundos",
  },
] as const;

export type LargoDeRespuesta = (typeof LARGOS_DE_RESPUESTA)[number]["clave"];

/**
 * La de omision es la CORTA, y es una decision, no un descuido.
 *
 * Quien estrena la funcion la prueba con una pregunta suelta; si lo primero
 * que recibe es un informe de un minuto, no hay segunda prueba. Quien quiera
 * todo lo enciende en Ajustes y lo sabe.
 */
export const LARGO_POR_OMISION: LargoDeRespuesta = "CONCISA";

export function esLargoValido(v: unknown): v is LargoDeRespuesta {
  return LARGOS_DE_RESPUESTA.some((l) => l.clave === v);
}

export function largoDe(v: string | null | undefined): LargoDeRespuesta {
  return esLargoValido(v) ? v : LARGO_POR_OMISION;
}

/** Lo que se le agrega a las instrucciones del analista segun el largo. */
export const INSTRUCCION_DE_LARGO: Record<LargoDeRespuesta, string> = {
  CONCISA: `Esta respuesta se va a LEER EN VOZ ALTA y quien la oye esta parado esperando.

El PRIMER parrafo es la respuesta directa a lo que se pregunto: una o dos frases, con la cifra y su periodo, y nada mas. Tiene que entenderse solo, sin lo que venga despues.

Lo demas —el contexto que cambia la lectura, la aclaracion, lo que noto de pendiente— va en parrafos SIGUIENTES, separados por un renglon en blanco. No lo quite: se lee en pantalla. Pero no lo meta en el primer parrafo.`,
  COMPLETA: "",
};

/**
 * Lo que se dice en voz alta, a partir de la respuesta completa.
 *
 * En concisa se habla el primer parrafo. La division es por renglon en blanco
 * y la hace TypeScript, no el modelo: pedirle que ademas marque donde cortar
 * es una instruccion mas que puede incumplir.
 *
 * Si no hay parrafos —el modelo contesto de corrido— se dice TODO. Hablar de
 * mas es molesto; cortar una frase a la mitad deja a alguien con medio dato y
 * sin saber que le falta, y eso es peor.
 */
export function loQueSeDice(
  respuesta: string,
  largo: LargoDeRespuesta,
): { texto: string; hayMas: boolean } {
  if (largo === "COMPLETA") return { texto: respuesta, hayMas: false };

  const parrafos = respuesta.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (parrafos.length <= 1) return { texto: respuesta, hayMas: false };

  return { texto: parrafos[0], hayMas: true };
}

/**
 * Lo que se dice al final cuando quedo detalle sin decir.
 *
 * Sin esto, quien oye una respuesta corta no tiene como saber que hay mas, y
 * el sistema parece que sabe menos de lo que sabe.
 */
export const HAY_MAS_ESCRITO = "Le dejo el detalle escrito.";
