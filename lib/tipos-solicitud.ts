/**
 * Que clase de solicitud es, y como se traduce a trabajo.
 *
 * Un solo lugar decide el mapeo. Antes cada camino de conversion escribia
 * "CORRECTIVE" a fuego, asi que una mejora o un apoyo entraban como falla e
 * inflaban el Pareto y el MTBF sin que nadie lo notara.
 */
export const TIPOS_SOLICITUD = {
  FALLA: {
    etiqueta: "Reporte de falla",
    descripcion: "Algo se descompuso, no funciona o funciona mal.",
    /** Cuenta como falla: entra al Pareto, al MTBF y al paro no planeado. */
    maintenanceType: "CORRECTIVE",
  },
  MEJORA: {
    etiqueta: "Mejora",
    descripcion: "Funciona, pero se puede hacer mejor o mas seguro.",
    maintenanceType: "IMPROVEMENT",
  },
  APOYO: {
    etiqueta: "Apoyo",
    descripcion: "Prestar manos: mover algo, una maniobra, ayudar a producción.",
    /**
     * Consume horas y cuesta, pero no es una falla del equipo ni mantenimiento
     * planeado. Queda fuera de los dos lados del indicador.
     */
    maintenanceType: "SUPPORT",
  },
  OTRO: {
    etiqueta: "Otro",
    descripcion: "No encaja en los anteriores. Alguien lo tiene que mirar.",
    /**
     * Se trata como correctivo por omision, que es lo mas conservador: mejor
     * atenderlo como si fuera falla y luego reclasificar, que dejarlo fuera de
     * los indicadores y que nadie lo vea.
     */
    maintenanceType: "CORRECTIVE",
  },
} as const;

export type ClaveTipoSolicitud = keyof typeof TIPOS_SOLICITUD;

export const esTipoValido = (t: string | null | undefined): t is ClaveTipoSolicitud =>
  !!t && t in TIPOS_SOLICITUD;

/**
 * El tipo de mantenimiento que le toca a la actividad.
 *
 * Sin clasificar cae en correctivo: mientras nadie la revise, se asume lo mas
 * urgente. Al clasificarla en el triage, la conversion usa lo que se decidio.
 */
export function tipoDeTrabajo(tipoSolicitud: string | null | undefined): string {
  return esTipoValido(tipoSolicitud)
    ? TIPOS_SOLICITUD[tipoSolicitud].maintenanceType
    : "CORRECTIVE";
}
