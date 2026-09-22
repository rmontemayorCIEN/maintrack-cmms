/**
 * Como esta una refaccion, decidido en un solo lugar.
 *
 * El analisis del almacen ya tenia el criterio de «bajo minimo» escrito a mano
 * dentro de su consulta. En cuanto una segunda pantalla dibuje existencias, la
 * unica forma de que las dos digan lo mismo es que las dos pregunten aqui.
 * Es la misma leccion de `lib/fallas.ts` y de `lib/alertas.ts`.
 *
 * ── Sin minimo no se dice que esta bien: se dice que no se sabe ──
 *
 * Una refaccion sin minimo capturado NO es una refaccion sana. Nadie ha dicho
 * cuanto deberia haber, asi que no hay contra que comparar. Pintarla de verde
 * seria inventar una tranquilidad que no existe, y esconder justo lo que hay
 * que capturar. Por eso `sinControl` es un estado propio y se ve.
 *
 * ── Agotada cuenta como bajo minimo ──
 *
 * El analisis mete las agotadas dentro de «bajo minimo» —cero es menos que el
 * minimo— y esta bien: para reponer son lo mismo. Pero para mirar la planta no
 * son lo mismo, porque una en cero puede tener una orden detenida. Asi que se
 * dibujan aparte y se cuentan juntas: `estaBajoMinimo` es el criterio del
 * analisis, y `estadoDeRefaccion` es el detalle para pintar. Uno nunca
 * contradice al otro.
 */

export type EstadoRefaccion = "agotada" | "bajoMinimo" | "excedida" | "sana" | "sinControl";

/**
 * Lo minimo para saber si falta: cuanto hay y cuanto deberia haber.
 *
 * El maximo va aparte porque no todos lo capturan y porque no hace falta para
 * la pregunta que mas se hace. Pedirlo obligaba a traerlo en consultas que no
 * lo usan, solo para satisfacer al compilador.
 */
export type Nivel = {
  quantityOnHand: number;
  minQuantity: number;
};

export type Existencia = Nivel & {
  maxQuantity?: number | null;
};

/**
 * El criterio del analisis del almacen: hay menos de lo que deberia haber.
 *
 * Incluye las agotadas. Sin minimo capturado devuelve false, porque no hay
 * nada contra que comparar —no porque este bien—.
 */
export function estaBajoMinimo(p: Nivel): boolean {
  return p.minQuantity > 0 && p.quantityOnHand < p.minQuantity;
}

/** Si nadie dijo cuanto deberia haber, no se puede opinar. */
export function sinControl(p: Nivel): boolean {
  return !(p.minQuantity > 0);
}

/** Como esta esta refaccion, para pintarla. */
export function estadoDeRefaccion(p: Existencia): EstadoRefaccion {
  if (sinControl(p)) return "sinControl";
  if (p.quantityOnHand <= 0) return "agotada";
  if (p.quantityOnHand < p.minQuantity) return "bajoMinimo";
  const max = p.maxQuantity ?? 0;
  if (max > 0 && p.quantityOnHand > max) return "excedida";
  return "sana";
}

/** De lo que mas urge a lo que menos, para ordenar filas y leyendas. */
export const ORDEN_ESTADO: EstadoRefaccion[] = ["agotada", "bajoMinimo", "sinControl", "excedida", "sana"];

export const ETIQUETA_ESTADO: Record<EstadoRefaccion, string> = {
  agotada: "Agotada",
  bajoMinimo: "Bajo mínimo",
  sinControl: "Sin mínimo",
  excedida: "Por encima del máximo",
  sana: "En nivel",
};
