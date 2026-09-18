/**
 * Los estados de un lote de importación, en un solo lugar: los lee el motor,
 * la reversión, la demostración, la puesta en marcha y la pantalla del
 * historial. Sin dependencias, para que cualquiera pueda importarlo.
 */
export type EstadoLote =
  | "VALIDADA" | "CONFIRMADA" | "COMPLETADA" | "COMPLETADA_CON_ADVERTENCIAS" | "FALLIDA"
  | "REVERTIDA" | "REVERSION_PARCIAL" | "REVERSION_BLOQUEADA";

/** Los lotes que dejaron registros vivos: los que se pueden revertir. */
export const ESTADOS_CON_REGISTROS: EstadoLote[] = [
  "COMPLETADA", "COMPLETADA_CON_ADVERTENCIAS", "REVERSION_PARCIAL", "REVERSION_BLOQUEADA",
];

/** Cómo se dice cada estado en pantalla. */
export const ESTADO_LOTE: Record<EstadoLote, { texto: string; tono: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  VALIDADA: { texto: "Validada", tono: "info" },
  CONFIRMADA: { texto: "Confirmada", tono: "info" },
  COMPLETADA: { texto: "Completada", tono: "success" },
  COMPLETADA_CON_ADVERTENCIAS: { texto: "Completada con advertencias", tono: "warning" },
  FALLIDA: { texto: "Fallida", tono: "danger" },
  REVERTIDA: { texto: "Revertida", tono: "neutral" },
  REVERSION_PARCIAL: { texto: "Reversión parcial", tono: "warning" },
  REVERSION_BLOQUEADA: { texto: "Reversión bloqueada", tono: "danger" },
};
