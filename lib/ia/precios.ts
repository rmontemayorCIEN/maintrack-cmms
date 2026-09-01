/**
 * Tarifas de los modelos y conversion de tokens a dinero.
 *
 * Anthropic factura en dolares por millon de tokens. Aqui se traduce cada
 * llamada a su costo real para poder responder, por cliente y por periodo,
 * cuanto nos cuesta darle la funcion de IA.
 *
 * Las tarifas se revisan contra la lista de precios publicada; si cambian, se
 * cambian aqui y todo lo demas sigue cuadrando, porque el costo se guarda ya
 * calculado en cada consumo (AiUsage.costoUsd) y no se recalcula despues.
 */

/** Dolares por millon de tokens. */
export type Tarifa = { entrada: number; salida: number };

export const TARIFAS: Record<string, Tarifa> = {
  "claude-opus-5": { entrada: 5, salida: 25 },
  "claude-sonnet-5": { entrada: 2, salida: 10 },
  "claude-haiku-4-5": { entrada: 1, salida: 5 },
};

export const MODELO_PREDETERMINADO = "claude-opus-5";

/**
 * Multiplicadores del cache sobre la tarifa de entrada.
 *
 * Leer del cache cuesta una decima parte; escribirlo cuesta 25% mas que un
 * token normal con vigencia de 5 minutos. Hoy el diagnostico semanal no usa
 * cache —una llamada por cliente por semana no reutiliza nada—, pero el
 * calculo queda listo para cuando se agreguen las funciones interactivas.
 */
const CACHE_LECTURA = 0.1;
const CACHE_ESCRITURA = 1.25;

export type UsoTokens = {
  entrada: number;
  salida: number;
  cacheLectura?: number;
  cacheEscritura?: number;
};

/** Costo en dolares de una llamada. Devuelve 0 si el modelo no esta tarifado. */
export function costoUsd(modelo: string, uso: UsoTokens): number {
  const t = TARIFAS[modelo];
  if (!t) return 0;
  const porMillon = (tokens: number, precio: number) => (tokens / 1_000_000) * precio;
  return (
    porMillon(uso.entrada, t.entrada) +
    porMillon(uso.salida, t.salida) +
    porMillon(uso.cacheLectura ?? 0, t.entrada * CACHE_LECTURA) +
    porMillon(uso.cacheEscritura ?? 0, t.entrada * CACHE_ESCRITURA)
  );
}

/** Formatea dolares con la precision que hace falta: son cantidades chicas. */
export function formatoUsd(monto: number): string {
  if (monto === 0) return "$0.00 USD";
  if (monto < 0.01) return `<$0.01 USD`;
  return `$${monto.toFixed(monto < 1 ? 3 : 2)} USD`;
}
