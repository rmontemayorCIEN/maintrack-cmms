/**
 * Catalogo de funciones de IA.
 *
 * Cada llamada al modelo pertenece a una funcion, y cada funcion cuesta un
 * numero de "operaciones" de la bolsa mensual del cliente. Se cobra en
 * operaciones y no en tokens a proposito: un jefe de mantenimiento entiende
 * "40 analisis al mes"; nadie compra tokens.
 */

export type ClaveFuncionIA =
  | "DIAGNOSTICO" | "CIERRE_OT" | "PLAN" | "REFACCIONES" | "BUSQUEDA"
  | "LEVANTAMIENTO" | "PLACA" | "FOTO_AREA" | "REVISION" | "AYUDA" | "TRIAGE" | "RECURRENCIA" | "DEDUPE" | "PROCEDIMIENTO";

export type DefinicionFuncionIA = {
  nombre: string;
  descripcion: string;
  /** Cuanto descuenta de la bolsa mensual del cliente. */
  operaciones: number;
  /** Si ya esta implementada. Las demas se anuncian como proximas. */
  disponible: boolean;
};

export const FUNCIONES_IA: Record<ClaveFuncionIA, DefinicionFuncionIA> = {
  DIAGNOSTICO: {
    nombre: "Diagnostico semanal",
    descripcion:
      "Cada semana la IA revisa indicadores, backlog, costos y calidad de captura, y entrega hallazgos con evidencia, acciones y una matriz FODA.",
    operaciones: 1,
    disponible: true,
  },
  CIERRE_OT: {
    nombre: "Asistente de cierre de orden",
    descripcion:
      "Al cerrar una orden, propone codigo de falla, causa raiz y refacciones a partir de lo que escribio el tecnico.",
    operaciones: 1,
    disponible: true,
  },
  PLAN: {
    nombre: "Generador de planes",
    descripcion:
      "Redacta el plan completo de un activo: actividades, frecuencia, mano de obra por especialidad, refacciones y servicios externos.",
    operaciones: 2,
    disponible: true,
  },
  REFACCIONES: {
    nombre: "Refacciones sugeridas por equipo",
    descripcion:
      "Propone que refacciones conviene tener en almacen para un equipo, sobre todo cuando aun no hay consumo del cual deducirlo.",
    operaciones: 1,
    disponible: true,
  },
  LEVANTAMIENTO: {
    nombre: "Levantamiento de inventario",
    descripcion:
      "Entrevista sobre la instalacion y propone el inventario de activos completo, agrupado por sistema, listo para revisar y dar de alta.",
    operaciones: 3,
    disponible: true,
  },
  FOTO_AREA: {
    nombre: "Reconocimiento por fotografia",
    descripcion:
      "De la foto de un cuarto de maquinas o un area identifica los equipos que se ven, para completar el levantamiento con lo que la entrevista no alcanzo.",
    operaciones: 1,
    disponible: true,
  },
  PLACA: {
    nombre: "Lectura de placa",
    descripcion:
      "De la fotografia de la placa de un equipo extrae fabricante, modelo, serie y datos tecnicos, y avisa si la foto no sirve.",
    operaciones: 1,
    disponible: true,
  },
  REVISION: {
    nombre: "Revision de configuracion",
    descripcion:
      "Revisa como quedo armada la cuenta y senala lo que una lista de verificacion no puede ver: cobertura desbalanceada, datos que no se conectan, escalas que no cuadran.",
    operaciones: 1,
    disponible: true,
  },
  PROCEDIMIENTO: {
    nombre: "Procedimiento de correctiva",
    descripcion:
      "Prepara el trabajo de una falla: como asegurar el equipo, los pasos en orden, que medir y contra que, y que refacciones del catalogo llevar.",
    operaciones: 2,
    disponible: true,
  },
  DEDUPE: {
    nombre: "Limpieza del catalogo",
    descripcion:
      "Revisa las refacciones que parecen duplicadas y distingue las que son la misma pieza de las que solo se llaman parecido.",
    operaciones: 2,
    disponible: true,
  },
  RECURRENCIA: {
    nombre: "Analisis de recurrencia",
    descripcion:
      "Lee el historial de fallas de un equipo y explica el patron: que las une y si se esta tratando el sintoma en vez de la causa.",
    operaciones: 2,
    disponible: true,
  },
  TRIAGE: {
    nombre: "Triage de solicitudes",
    descripcion:
      "Lee lo que reporto alguien que no es de mantenimiento —con su foto— y propone titulo, prioridad, tipo y posibles duplicados.",
    operaciones: 1,
    disponible: true,
  },
  AYUDA: {
    nombre: "Ayuda con IA",
    descripcion:
      "Dudas sobre como usar el sistema, contestadas con la documentacion y —cuando la pregunta es sobre su caso— con sus propios datos.",
    operaciones: 1,
    disponible: true,
  },
  BUSQUEDA: {
    nombre: "Consulta en lenguaje natural",
    descripcion:
      "Preguntas como «cuanto lleve gastado en el compresor este año» respondidas sobre sus propios datos.",
    operaciones: 1,
    disponible: true,
  },
};

export const CLAVES_FUNCION_IA = Object.keys(FUNCIONES_IA) as ClaveFuncionIA[];
