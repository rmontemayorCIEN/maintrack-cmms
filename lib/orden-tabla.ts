/**
 * Como se ordena una lista al tocar el titulo de una columna.
 *
 * Vive fuera del componente para poder probarlo sin navegador: son dos
 * decisiones pequeñas y faciles de equivocar —el ciclo de tres estados y la
 * comparacion de valores— que de otro modo solo se comprobarian a ojo.
 */

export type Orden = { id: string; dir: "asc" | "desc" };

/**
 * Un toque ordena, el segundo invierte, el tercero lo quita.
 *
 * El tercer estado no es un adorno: sin el, en cuanto se toca una columna ya
 * no se puede volver al orden con que llego la lista, que muchas veces es el
 * que importa —lo mas reciente primero, o el orden del folio—.
 *
 * Tocar OTRA columna empieza de nuevo en ascendente: heredar el sentido de la
 * columna anterior sorprende, porque nadie recuerda como dejo la de antes.
 */
export function siguienteOrden(actual: Orden | null, id: string): Orden | null {
  if (!actual || actual.id !== id) return { id, dir: "asc" };
  if (actual.dir === "asc") return { id, dir: "desc" };
  return null;
}

/**
 * Compara dos valores de la misma columna.
 *
 * Con `numeric` el navegador entiende los numeros dentro del texto, asi que
 * «OT-10» queda despues de «OT-9» en vez de antes, que es lo que hace un
 * comparador de palabras y lo que hace que la gente deje de confiar en el
 * orden de una lista. `sensitivity: "base"` iguala mayusculas y acentos, para
 * que «Ácido» no se vaya al final.
 *
 * Los numeros se comparan como numeros. Una columna de dinero cuyo texto es
 * «$1,200» tiene que declarar `ordenPor`, porque como texto el 1,200 se
 * ordena antes que el 900.
 */
export function compararValores(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es", { numeric: true, sensitivity: "base" });
}
