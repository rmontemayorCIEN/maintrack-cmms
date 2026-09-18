/**
 * Dónde está la empresa en su arranque. Es distinto del estado comercial
 * (prueba, activa, suspendida), que lo maneja el operador y que este no toca.
 *
 *  - CONFIGURACION: hay bloqueos críticos.
 *  - LISTA: sin bloqueos críticos; falta declararlo.
 *  - OPERANDO: alguien lo declaró, con fecha y nombre.
 *
 * Es informativo: no apaga ninguna función. Una empresa que ya trabajaba
 * antes de existir este estado sigue trabajando igual. Sin dependencias: lo
 * leen las pantallas.
 */
export type EstadoOperativo = "CONFIGURACION" | "LISTA" | "OPERANDO";

export const ESTADO_OPERATIVO: Record<EstadoOperativo, { texto: string; tono: "warning" | "info" | "success" }> = {
  CONFIGURACION: { texto: "En configuración", tono: "warning" },
  LISTA: { texto: "Lista para operar", tono: "info" },
  OPERANDO: { texto: "Operando", tono: "success" },
};
