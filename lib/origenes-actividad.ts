/**
 * De donde vino cada actividad de una orden, para poder mostrarlo agrupado.
 *
 * En la lista de verificacion todas se veian igual: los pasos que propuso la
 * IA, la rutina del plan preventivo y el reporte de falla que alguien levanto
 * ahi mismo aparecian mezclados y sin distintivo. El tecnico no sabia que
 * estaba viendo, y el supervisor tampoco.
 *
 * LOS GRUPOS NO SE REORDENAN. Van en el orden en que estan las actividades.
 *
 * El primer intento los ordeno por urgencia —los reportes arriba, el plan
 * despues— y eso puso una reparacion ANTES del bloqueo y etiquetado del
 * equipo. La lista se ejecuta de arriba abajo: alterar su orden mueve los
 * pasos de seguridad de lugar. Agrupar es para distinguir de un vistazo, no
 * para decidir por el tecnico en que orden trabajar.
 *
 * Como efecto util, la numeracion sigue ascendiendo y coincide con la del
 * papel impreso, que ordena por posicion.
 */
export const ORIGENES = {
  SOLICITUD: {
    etiqueta: "De reportes y solicitudes",
    ayuda: "Lo que alguien reporto: fallas, mejoras o apoyos.",
    tono: "ambar",
  },
  ALERTA: {
    etiqueta: "De alertas predictivas",
    ayuda: "Lo que el monitoreo de condicion detecto antes de que fallara.",
    tono: "violeta",
  },
  PLAN: {
    etiqueta: "Del plan preventivo",
    ayuda: "La rutina programada para este equipo.",
    tono: "azul",
  },
  IA: {
    etiqueta: "Procedimiento sugerido por IA",
    ayuda: "Pasos propuestos a partir del equipo y de reparaciones anteriores. Los reviso alguien antes de aplicarlos.",
    tono: "marca",
  },
  BACKLOG: {
    etiqueta: "Retomado de trabajo pendiente",
    ayuda: "Quedo trabado en una orden anterior y se retoma aqui.",
    tono: "gris",
  },
  MANUAL: {
    etiqueta: "Agregadas a mano",
    ayuda: "Capturadas directamente en esta orden.",
    tono: "gris",
  },
} as const;

export type ClaveOrigen = keyof typeof ORIGENES;

/** Solo para desempatar si dos grupos empezaran en la misma posicion. */
export const ORDEN_DE_GRUPOS: ClaveOrigen[] =
  ["PLAN", "IA", "SOLICITUD", "ALERTA", "BACKLOG", "MANUAL"];

export function origenValido(o: string | null | undefined): ClaveOrigen {
  return o && o in ORIGENES ? (o as ClaveOrigen) : "MANUAL";
}

/** Colores por grupo. Se resuelven aqui para que las dos vistas coincidan. */
export const TONOS: Record<string, { borde: string; fondo: string; texto: string }> = {
  ambar:   { borde: "border-amber-200",  fondo: "bg-amber-50",   texto: "text-amber-800" },
  violeta: { borde: "border-violet-200", fondo: "bg-violet-50",  texto: "text-violet-700" },
  azul:    { borde: "border-sky-200",    fondo: "bg-sky-50",     texto: "text-sky-700" },
  marca:   { borde: "border-brand-200",  fondo: "bg-brand-50",   texto: "text-brand-700" },
  gris:    { borde: "border-slate-200",  fondo: "bg-slate-50",   texto: "text-slate-600" },
};
