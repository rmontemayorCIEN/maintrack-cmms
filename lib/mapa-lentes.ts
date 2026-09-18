/**
 * Las tres vistas del mapa y sus colores, en un solo lugar.
 *
 * Las usan el mapa de cada línea y las miniaturas de la lista: el mismo
 * equipo tiene que pintarse igual en los dos lados, o la lista diría una cosa
 * y el mapa otra. Sin dependencias: lo leen las pantallas.
 *
 * Cruzado con el filtro por tipo de equipo, cada combinación es la pregunta de
 * alguien: "solo compresores + cómo están ahora" es la mañana de un jefe de
 * mantenimiento; "solo bombas + lo que costó" es su junta de presupuesto.
 */
export const LENTES = {
  AHORA: { etiqueta: "Cómo está ahora", ayuda: "El color es el estado de cada equipo en este momento. Toque uno para ver sus órdenes." },
  COSTO: { etiqueta: "Lo que costó", ayuda: "El color son las horas que estuvo parado en el periodo. Solo se cobra el paro de equipos que detienen la producción." },
  PENDIENTE: { etiqueta: "Lo que trae pendiente", ayuda: "El color son los planes vencidos y las órdenes abiertas de cada equipo." },
} as const;
export type Lente = keyof typeof LENTES;

export function esLente(v: unknown): v is Lente {
  return typeof v === "string" && v in LENTES;
}

/** El color del estado de ahora. */
export function tonoEstado(status: string): string {
  switch (status) {
    case "DOWN": return "#a32a12";
    case "DEGRADED": return "#c07818";
    case "STANDBY": return "#8592a6";
    case "RETIRED": return "#b9c2d0";
    default: return "#2f7d5d";
  }
}

/** La rampa de calor, la misma del croquis de planta. */
export function rampa(p: number): string {
  if (p >= 0.75) return "#9e2f12";
  if (p >= 0.45) return "#c4522a";
  if (p >= 0.2) return "#d9622c";
  if (p > 0) return "#e08b4f";
  return "#b9c2d0";
}

/**
 * El color de lo pendiente, en escala ABSOLUTA y no contra el maximo.
 *
 * Normalizado contra el maximo, cuatro equipos con una orden abierta cada uno
 * salian los cuatro en rojo maximo: la pantalla gritaba catastrofe donde habia
 * normalidad. En el lente de costo la comparacion relativa si dice algo —quien
 * concentra el dano—, pero "tiene pendientes" no es una carrera: uno es uno.
 *
 * Un plan vencido pesa el doble que una orden abierta. Una orden abierta es
 * trabajo en curso; un plan vencido es trabajo que ya debio hacerse y no se
 * hizo, y es lo que termina en falla.
 */
export function tonoPendiente(vencidos: number, abiertas: number): string {
  const peso = vencidos * 2 + abiertas;
  if (peso === 0) return "#b9c2d0";
  if (peso === 1) return "#e08b4f";
  if (peso <= 3) return "#d9622c";
  if (peso <= 5) return "#c4522a";
  return "#9e2f12";
}
