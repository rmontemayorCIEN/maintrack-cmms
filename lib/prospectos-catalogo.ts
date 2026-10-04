/** Catálogos de prospectos, sin base de datos: los usan también las pantallas. */

export const RANGOS_ACTIVOS = ["1-50", "51-200", "201-1000", "1000+"] as const;

export const ESTADOS_PROSPECTO = [
  { clave: "NUEVA", nombre: "Nueva" },
  { clave: "CONTACTADA", nombre: "Contactada" },
  { clave: "DEMO_AGENDADA", nombre: "Demostración agendada" },
  { clave: "DEMO_REALIZADA", nombre: "Demostración realizada" },
  { clave: "PROPUESTA", nombre: "Propuesta enviada" },
  { clave: "GANADA", nombre: "Ganada" },
  { clave: "PERDIDA", nombre: "Perdida" },
  { clave: "DESCARTADA", nombre: "Descartada (duplicada o no aplica)" },
] as const;
export type EstadoProspecto = (typeof ESTADOS_PROSPECTO)[number]["clave"];

export const MOTIVOS_PERDIDA = ["Precio", "Eligió otra herramienta", "Se quedan con hojas de cálculo o su ERP", "No es el momento", "No respondió", "No cumple una necesidad", "Otro"] as const;
