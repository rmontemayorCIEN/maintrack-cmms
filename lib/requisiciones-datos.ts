/**
 * Los nombres y las reglas de una requisicion que NO tocan la base.
 *
 * Viven aparte porque las pantallas del navegador los leen —el dialogo de alta,
 * la tabla, el detalle— y `lib/requisiciones.ts` arrastra Prisma y, desde que
 * recalcula el costo de la orden, tambien los avisos al celular (web-push).
 * Importar eso desde el navegador rompe la compilacion con un «Can't resolve
 * 'net'» que no menciona la causa. Ya paso con `lib/plan-tasks.ts`.
 */

export const MOTIVOS = {
  PREVENTIVO: "Mantenimiento preventivo",
  CORRECTIVO: "Mantenimiento correctivo",
  MINIMO: "Reposición de mínimo",
  PROYECTO: "Proyecto especial",
  /// Una misma requisicion puede llevar material de actividades de distinto
  /// tipo: el preventivo del mes y la fuga que se reporto. El encabezado lo
  /// dice, y cada renglon conserva el suyo.
  MIXTA: "Varios tipos (ver cada renglón)",
} as const;

/** Texto de la actividad que origina un renglon cuando no hay ninguna. */
export const SIN_ACTIVIDAD = "Actividad no especificada";
export const CONSUMO_GENERAL = "Consumo general de la OT";

export const URGENCIAS = {
  NORMAL: "Normal",
  ALTA: "Alta",
  PARO: "Equipo parado",
} as const;

export const ESTADOS = {
  SOLICITADA: "Solicitada",
  PARCIAL: "Surtida en parte",
  SURTIDA: "Surtida",
  CERRADA: "Cerrada",
  CANCELADA: "Cancelada",
} as const;

export type Motivo = keyof typeof MOTIVOS;
export type Urgencia = keyof typeof URGENCIAS;
export type Estado = keyof typeof ESTADOS;

/**
 * El motivo que le corresponde a una requisicion segun el trabajo que la pide.
 *
 * Se deduce del tipo de la orden y no se deja al formulario: el valor por
 * omision era «correctivo» y asi quedaron clasificadas requisiciones de
 * preventivos (RM-000001, RM-000003 y RM-000004 en produccion). Con el motivo
 * mal puesto, el material preventivo se lee como correctivo y la mezcla de
 * mantenimiento deja de ser cierta.
 */
export function motivoDeLaOrden(maintenanceType: string | null | undefined): Motivo {
  switch (maintenanceType) {
    case "PREVENTIVE":
    case "INSPECTION":
    case "PREDICTIVE":
      return "PREVENTIVO";
    case "CORRECTIVE":
    case "SAFETY":
      return "CORRECTIVO";
    case "IMPROVEMENT":
    case "SUPPORT":
      return "PROYECTO";
    default:
      return "CORRECTIVO";
  }
}

/**
 * El motivo del encabezado, deducido de los tipos de sus renglones.
 *
 * Deja de ser el dato que clasifica —eso lo hace cada renglon con su
 * actividad— y pasa a ser un resumen: si todo el vale es del mismo tipo lo
 * dice, y si mezcla lo dice tambien en vez de escoger uno y mentir.
 */
export function motivoDeRenglones(tipos: Array<string | null>, sinOrden?: Motivo): Motivo {
  const conTipo = tipos.filter(Boolean) as string[];
  if (!conTipo.length) return sinOrden ?? "PROYECTO";
  const motivos = new Set(conTipo.map((t) => motivoDeLaOrden(t)));
  return motivos.size === 1 ? [...motivos][0] : "MIXTA";
}

/**
 * El estado que le corresponde a la requisicion segun sus renglones.
 *
 * Se calcula, no se captura: un estado escrito a mano se desincroniza del
 * primer surtido parcial que alguien registre sin acordarse de moverlo.
 */
export function estadoSegunRenglones(
  renglones: Array<{ cantidadSolicitada: number; cantidadSurtida: number }>,
): Estado {
  const surtido = renglones.reduce((s, r) => s + r.cantidadSurtida, 0);
  if (surtido === 0) return "SOLICITADA";
  const completo = renglones.every((r) => r.cantidadSurtida >= r.cantidadSolicitada);
  return completo ? "SURTIDA" : "PARCIAL";
}
