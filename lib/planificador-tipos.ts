/**
 * Como se llama cada cosa del planificador de compras, para la pantalla.
 *
 * Vive aparte de `lib/planificador-compras.ts` a proposito, igual que
 * `estados-compra.ts` y `vigencias-tipos.ts`: la tabla es un componente de
 * cliente y solo necesita estos nombres. Si los tomara del modulo con la
 * logica, el empaquetador arrastraria prisma al navegador y la compilacion se
 * caeria con un «no encuentro tls» que no dice nada de la causa real.
 */

/**
 * Que tan urgente es pedir, y por que.
 *
 * No es una escala de gravedad inventada: sale de comparar cuando se acaba el
 * material contra cuanto tarda en llegar. Un balero que se acaba en diez dias
 * y tarda quince NO se puede pedir «pronto»: ya se pidio tarde.
 */
export const URGENCIAS_PLAN = {
  TARDE: {
    etiqueta: "Ya va tarde",
    tono: "danger" as const,
    explica: "Se acaba antes de que alcance a llegar, aunque se pida hoy.",
  },
  HOY: {
    etiqueta: "Pida hoy",
    tono: "warning" as const,
    explica: "Justo alcanza si se pide hoy; un dia mas y no llega a tiempo.",
  },
  PRONTO: {
    etiqueta: "Pronto",
    tono: "info" as const,
    explica: "Todavia hay margen, pero conviene juntarlo con otra compra.",
  },
  VIGILAR: {
    etiqueta: "Vigilar",
    tono: "muted" as const,
    explica: "Alcanza para el horizonte; se lista para no perderlo de vista.",
  },
} as const;

export type UrgenciaPlan = keyof typeof URGENCIAS_PLAN;

/** El orden en que se atienden: lo que ya va tarde, primero. */
export const ORDEN_URGENCIA: UrgenciaPlan[] = ["TARDE", "HOY", "PRONTO", "VIGILAR"];

/**
 * De donde salio la cantidad que se propone.
 *
 * Se muestra junto al numero porque un planificador que dice «pida 14» sin
 * decir por que no se usa: el comprador no puede defender esa cifra ante quien
 * la firma, y termina pidiendo lo de siempre.
 */
export const ORIGENES_DEMANDA = {
  PLAN: "lo que comprometen los preventivos",
  HISTORICO: "lo que se ha consumido de verdad",
  MINIMO: "el minimo del almacen",
} as const;

export type OrigenDemanda = keyof typeof ORIGENES_DEMANDA;
